const fs = require('fs');
const path = require('path');
const { program } = require('commander');
const xlsx = require('xlsx');
const knex = require('knex');
const dotenv = require('dotenv');
const readline = require('readline');
const { performance } = require('perf_hooks');

// Load environment variables
dotenv.config();

// Configure CLI options
program
  .version('1.0.0')
  .description('Import XLSX data into a relational database')
  .option('-i, --input <file>', 'Input XLSX file (default: stdin)')
  .option('-o, --output <format>', 'Output format (default: stdout)', 'stdout')
  .option('-d, --database <type>', 'Database type (mysql, postgres, sqlite)', process.env.DB_TYPE || 'sqlite')
  .option('-t, --table <name>', 'Table name to import into', process.env.TABLE_NAME || 'persons')
  .option('-c, --config <file>', 'Database configuration file', process.env.DB_CONFIG || './.env')
  .option('--create-table', 'Create table if not exists', false)
  .option('--truncate-table', 'Truncate table before import', false)
  .parse(process.argv);

const options = program.opts();

// Database configuration
const getDbConfig = () => {
  const dbType = options.database;
  let dbConfig = {};

  switch (dbType) {
    case 'mysql':
      dbConfig = {
        client: 'mysql2',
        connection: {
          host: process.env.DB_HOST || 'localhost',
          user: process.env.DB_USER || 'root',
          password: process.env.DB_PASSWORD || '',
          database: process.env.DB_NAME || 'test',
          charset: 'utf8mb4'
        }
      };
      break;
    case 'postgres':
      dbConfig = {
        client: 'pg',
        connection: {
          host: process.env.DB_HOST || 'localhost',
          user: process.env.DB_USER || 'postgres',
          password: process.env.DB_PASSWORD || '',
          database: process.env.DB_NAME || 'test',
        }
      };
      break;
    case 'sqlite':
    default:
      dbConfig = {
        client: 'sqlite3',
        connection: {
          filename: process.env.DB_FILE || './database.sqlite'
        },
        useNullAsDefault: true
      };
      break;
  }

  return dbConfig;
};

// Function to standardize date formats
const standardizeDate = (dateStr) => {
  if (!dateStr) return null;
  
  // Different date formats in the spreadsheet
  const formats = [
    // YYYY-MM-DD
    { regex: /^(\d{4})-(\d{2})-(\d{2})$/, transform: (m) => `${m[1]}-${m[2]}-${m[3]}` },
    // DD/MM/YYYY
    { regex: /^(\d{2})\/(\d{2})\/(\d{4})$/, transform: (m) => `${m[3]}-${m[2]}-${m[1]}` },
    // MM/DD/YYYY
    { regex: /^(\d{2})\/(\d{2})\/(\d{4})$/, transform: (m) => `${m[3]}-${m[1]}-${m[2]}` },
    // DD-MM-YYYY
    { regex: /^(\d{2})-(\d{2})-(\d{4})$/, transform: (m) => `${m[3]}-${m[2]}-${m[1]}` },
    // MM-DD-YYYY
    { regex: /^(\d{2})-(\d{2})-(\d{4})$/, transform: (m) => `${m[3]}-${m[1]}-${m[2]}` },
    // YYYY/MM/DD
    { regex: /^(\d{4})\/(\d{2})\/(\d{2})$/, transform: (m) => `${m[1]}-${m[2]}-${m[3]}` },
  ];

  for (const format of formats) {
    const match = dateStr.match(format.regex);
    if (match) {
      return format.transform(match);
    }
  }

  // Try to parse with Date
  try {
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
  } catch (e) {
    // If it fails, return the original string
    console.error(`Warning: Could not standardize date format for "${dateStr}"`);
    return dateStr;
  }
};

// Function to normalize column names (remove spaces, lowercase, etc.)
const normalizeColumnName = (name) => {
  return name
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^\w_]/g, '');
};

// Function to create SQL table schema
const createTableSchema = async (db, tableName, columns) => {
  try {
    // Check if table exists
    const tableExists = await db.schema.hasTable(tableName);
    
    if (tableExists && options.truncateTable) {
      await db(tableName).truncate();
      console.log(`Table '${tableName}' truncated successfully.`);
    }
    
    if (!tableExists && options.createTable) {
      await db.schema.createTable(tableName, (table) => {
        table.increments('id').primary();
        
        columns.forEach(column => {
          const normalizedName = normalizeColumnName(column);
          
          if (normalizedName === 'matricule') {
            table.string(normalizedName).unique();
          } else if (normalizedName === 'datedenaissance') {
            table.date(normalizedName);
          } else {
            table.string(normalizedName);
          }
        });
        
        table.timestamps(true, true);
      });
      
      console.log(`Table '${tableName}' created successfully.`);
    } else if (!tableExists && !options.createTable) {
      throw new Error(`Table '${tableName}' does not exist. Use --create-table option to create it.`);
    }
    
    return true;
  } catch (error) {
    console.error(`Error creating table schema: ${error.message}`);
    throw error;
  }
};

// Function to convert XLSX data to JSON
const parseXlsxFile = (filePath) => {
  try {
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // Convert to JSON
    const jsonData = xlsx.utils.sheet_to_json(worksheet);
    
    if (jsonData.length === 0) {
      throw new Error('No data found in the XLSX file');
    }
    
    // Extract column names from the first row
    const columns = Object.keys(jsonData[0]);
    
    // Normalize data
    const normalizedData = jsonData.map(row => {
      const normalizedRow = {};
      
      Object.entries(row).forEach(([key, value]) => {
        const normalizedKey = normalizeColumnName(key);
        
        // Handle date fields
        if (normalizedKey === 'datedenaissance') {
          normalizedRow[normalizedKey] = standardizeDate(value);
        } else {
          normalizedRow[normalizedKey] = value;
        }
      });
      
      return normalizedRow;
    });
    
    return {
      columns,
      data: normalizedData
    };
  } catch (error) {
    console.error(`Error parsing XLSX file: ${error.message}`);
    throw error;
  }
};

// Function to import data into database
const importData = async (db, tableName, data) => {
  try {
    const startTime = performance.now();
    
    // Use a transaction and batch insert for better performance
    await db.transaction(async (trx) => {
      // Chunk inserts for better performance with large datasets
      const chunkSize = 100;
      for (let i = 0; i < data.length; i += chunkSize) {
        const chunk = data.slice(i, i + chunkSize);
        await trx(tableName).insert(chunk);
      }
    });
    
    const endTime = performance.now();
    const duration = (endTime - startTime) / 1000; // Convert to seconds
    
    return {
      success: true,
      count: data.length,
      duration
    };
  } catch (error) {
    console.error(`Error importing data: ${error.message}`);
    throw error;
  }
};

// Function to handle stdin input
const readStdin = () => {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      const chunks = [];
      
      process.stdin.on('data', (chunk) => {
        chunks.push(chunk);
      });
      
      process.stdin.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const tempFile = path.join(process.cwd(), 'temp_import.xlsx');
        
        fs.writeFileSync(tempFile, buffer);
        resolve(tempFile);
      });
      
      process.stdin.on('error', (err) => {
        reject(err);
      });
    } else {
      reject(new Error('No data provided on stdin'));
    }
  });
};

// Main function
const main = async () => {
  try {
    let inputFile = options.input;
    
    // Handle stdin input
    if (!inputFile) {
      try {
        inputFile = await readStdin();
      } catch (error) {
        console.error(`Error reading from stdin: ${error.message}`);
        console.error('Please provide an input file with --input option or pipe data to the application.');
        process.exit(1);
      }
    }
    
    // Parse XLSX file
    const { columns, data } = parseXlsxFile(inputFile);
    
    // Initialize database connection
    const dbConfig = getDbConfig();
    const db = knex(dbConfig);
    
    // Create table if needed
    await createTableSchema(db, options.table, columns);
    
    // Import data
    const result = await importData(db, options.table, data);
    
    // Output result
    const output = {
      status: 'success',
      message: `Successfully imported ${result.count} records in ${result.duration.toFixed(3)} seconds`,
      table: options.table,
      database: options.database,
      records: result.count,
      duration: `${result.duration.toFixed(3)}s`
    };
    
    if (options.output === 'stdout') {
      console.log(JSON.stringify(output, null, 2));
    } else if (options.output === 'json') {
      fs.writeFileSync('import_result.json', JSON.stringify(output, null, 2));
      console.log('Results written to import_result.json');
    }
    
    // Close database connection
    await db.destroy();
    
    // Clean up temp file if created
    if (!options.input && fs.existsSync(inputFile)) {
      fs.unlinkSync(inputFile);
    }
    
    process.exit(0);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

// Run the application
main();