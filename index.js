#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { program } = require('commander');
const xlsx = require('xlsx');
const knex = require('knex');
const dotenv = require('dotenv');
const readline = require('readline');
const { performance } = require('perf_hooks');
const https = require('https');
const http = require('http');
const { URL } = require('url');
// const Spinner = require('cli-spinner').Spinner;
const ProgressBar = require('progress');

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
  .option('--handle-duplicates <mode>', 'How to handle duplicate matricule (skip, update, error)', 'update')
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
      // Generate a timestamp-based unique identifier
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

      // Create a unique filename using the timestamp
      const uniqueDbFile = `./database-${timestamp}.sqlite`;
      dbConfig = {
        client: 'sqlite3',
        connection: {
          filename: process.env.DB_FILE || uniqueDbFile
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
  
  // Check if the input is a number (Excel date serial number) or not a string
  if (typeof dateStr !== 'string') {
    try {
      // If it's a number, try to convert Excel serial date
      if (typeof dateStr === 'number') {
        // Excel dates are number of days since 1900-01-01 (except for the leap year bug)
        const excelEpoch = new Date(1899, 11, 30);
        const date = new Date(excelEpoch.getTime() + dateStr * 86400000);
        return date.toISOString().split('T')[0];
      }
      
      // If it's a Date object or can be converted to a date
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        return date.toISOString().split('T')[0];
      }
      
      // If we can't process it, convert to string
      return String(dateStr);
    } catch (e) {
      console.error(`Warning: Could not process non-string date value: ${dateStr}`);
      return String(dateStr);
    }
  }
  
  // Now we're sure dateStr is a string, we can use regex methods
  // Different date formats in the spreadsheet
  const formats = [
    // YYYY-MM-DD
    { regex: /^(\d{4})-(\d{2})-(\d{2})$/, transform: (m) => `${m[1]}-${m[2]}-${m[3]}` },
    // DD/MM/YYYY
    { regex: /^(\d{2})\/(\d{2})\/(\d{4})$/, transform: (m) => `${m[3]}-${m[2]}-${m[1]}` },
    // MM/DD/YYYY
    { regex: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, transform: (m) => `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` },
    // DD-MM-YYYY
    { regex: /^(\d{2})-(\d{2})-(\d{4})$/, transform: (m) => `${m[3]}-${m[2]}-${m[1]}` },
    // MM-DD-YYYY
    { regex: /^(\d{1,2})-(\d{1,2})-(\d{4})$/, transform: (m) => `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` },
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
  return String(name)
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
    
    // Convert to JSON with headers
    const jsonData = xlsx.utils.sheet_to_json(worksheet, { header: 1 });
    
    if (jsonData.length <= 1) {
      throw new Error('No data found in the XLSX file or only headers present');
    }
    
    // Extract column names from the first row
    const headers = jsonData[0].map(header => header ? String(header) : '');
    
    // Process the data rows
    const data = [];
    for (let i = 1; i < jsonData.length; i++) {
      const row = jsonData[i];
      
      // Skip empty rows
      if (!row || !row.length) continue;
      
      const rowData = {};
      for (let j = 0; j < headers.length; j++) {
        // Handle out of bounds (some rows might have fewer columns)
        if (j < row.length) {
          // Handle column names
          const header = headers[j] ? headers[j] : `column${j}`;
          const normalizedHeader = normalizeColumnName(header);
          
          // Process date fields
          if (normalizedHeader === 'datedenaissance') {
            rowData[normalizedHeader] = standardizeDate(row[j]);
          } else {
            rowData[normalizedHeader] = row[j];
          }
        }
      }
      
      data.push(rowData);
    }
    
    return {
      columns: headers,
      data
    };
  } catch (error) {
    console.error(`Error parsing XLSX file: ${error.message}`);
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

// Function to download a file from a URL
const downloadFile = (url) => {
  return new Promise((resolve, reject) => {
    console.log(`Downloading file from ${url}`);
    
    const parsedUrl = new URL(url);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;
    const tempFile = path.join(process.cwd(), 'temp_download.xlsx');
    
    const fileStream = fs.createWriteStream(tempFile);
    
    const request = protocol.get(url, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        console.log(`Redirecting to ${response.headers.location}`);
        fileStream.close();
        fs.unlinkSync(tempFile);
        downloadFile(response.headers.location).then(resolve).catch(reject);
        return;
      }
      
      if (response.statusCode !== 200) {
        console.log(`Failed to download file: ${response.statusCode} ${response.statusMessage}`);
        reject(new Error(`Failed to download file: ${response.statusCode} ${response.statusMessage}`));
        return;
      }
      
      const totalSize = parseInt(response.headers['content-length'], 10);
      let downloadedSize = 0;
      let bar;
      
      if (totalSize) {
        bar = new ProgressBar('Downloading [:bar] :percent :etas', {
          complete: '=',
          incomplete: ' ',
          width: 40,
          total: totalSize
        });
      }
      
      response.on('data', (chunk) => {
        downloadedSize += chunk.length;
        if (bar) {
          bar.tick(chunk.length);
        } else {
          process.stdout.clearLine(0);
          process.stdout.cursorTo(0);
          process.stdout.write(`Downloaded: ${(downloadedSize / 1024 / 1024).toFixed(2)} MB`);
        }
      });
      
      response.pipe(fileStream);
      
      fileStream.on('finish', () => {
        fileStream.close();
        if (!bar) {
          process.stdout.write('\n');
        }
        console.log('File downloaded successfully');
        resolve(tempFile);
      });
    });
    
    request.on('error', (err) => {
      console.log(`Download failed: ${err.message}`);
      fileStream.close();
      fs.unlinkSync(tempFile);
      reject(err);
    });
    
    fileStream.on('error', (err) => {
      console.log(`File write error: ${err.message}`);
      fileStream.close();
      fs.unlinkSync(tempFile);
      reject(err);
    });
  });
};

// Add a function to create progress bar for import operations
const createImportProgressBar = (total, operation) => {
  return new ProgressBar(`${operation} [:bar] :current/:total rows (:percent) :etas`, {
    complete: '=',
    incomplete: ' ',
    width: 40,
    total: total
  });
};

// The importData function to show progress
const importData = async (db, tableName, data) => {
  try {
    const startTime = performance.now();
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    
    const bar = createImportProgressBar(data.length, 'Importing');
    
    // Use a transaction for better performance and atomicity
    await db.transaction(async (trx) => {
      // Process records individually to handle duplicates
      for (const record of data) {
        try {
          // Check if a record with the same matricule already exists
          if ('matricule' in record) {
            const existing = await trx(tableName)
              .where('matricule', record.matricule)
              .first();
            
            if (existing) {
              // Handle duplicate based on the mode
              if (options.handleDuplicates === 'skip') {
                skipped++;
                bar.tick();
                continue;
              } else if (options.handleDuplicates === 'update') {
                // Update the existing record
                await trx(tableName)
                  .where('matricule', record.matricule)
                  .update(record);
                
                updated++;
                bar.tick();
                continue;
              } else if (options.handleDuplicates === 'error') {
                throw new Error(`Duplicate matricule: ${record.matricule}`);
              }
            }
          }
          
          // Insert new record
          await trx(tableName).insert(record);
          inserted++;
          bar.tick();
        } catch (err) {
          console.error(`Error processing record: ${err.message}`);
          console.error(record);
          failed++;
          bar.tick();
          
          // Don't fail the entire transaction for a single record
          if (options.handleDuplicates !== 'skip' && options.handleDuplicates !== 'update') {
            throw err;
          }
        }
      }
    });
    
    const endTime = performance.now();
    const duration = (endTime - startTime) / 1000; // Convert to seconds
    
    return {
      success: true,
      inserted,
      updated,
      skipped,
      failed,
      total: data.length,
      duration
    };
  } catch (error) {
    console.error(`Error importing data: ${error.message}`);
    throw error;
  }
};

// Main function
const main = async () => {
  console.log('Starting import process...');
  let inputFile = options.input;
  let isTemporaryFile = false;
  
  try {
    // Handle URL input
    if (inputFile && (inputFile.startsWith('http://') || inputFile.startsWith('https://'))) {
      try {
        inputFile = await downloadFile(inputFile);
        isTemporaryFile = true;
      } catch (error) {
        console.error(`Error downloading file: ${error.message}`);
        process.exit(1);
      }
    }
    // Handle stdin input
    else if (!inputFile) {
      console.log('Reading from stdin...');
      try {
        inputFile = await readStdin();
        isTemporaryFile = true;
        console.log('Data received from stdin');
      } catch (error) {
        console.error(`Error reading from stdin: ${error.message}`);
        console.error('Please provide an input file with --input option or pipe data to the application.');
        process.exit(1);
      }
    } else {
      console.log(`Reading file: ${inputFile}`);
    }
    
    // Parse XLSX file
    console.log('Parsing XLSX file...');
    const { columns, data } = parseXlsxFile(inputFile);
    console.log(`Parsed ${data.length} rows from XLSX file`);
    
    // Initialize database connection
    console.log('Connecting to database...');
    const dbConfig = getDbConfig();
    const db = knex(dbConfig);
    console.log(`Connected to ${options.database} database`);
    
    // Create table if needed
    console.log(`Checking table structure: ${options.table}`);
    await createTableSchema(db, options.table, columns);
    console.log(`Table structure verified: ${options.table}`);
    
    // Import data - function now has its own progress bar
    console.log(`Importing data to table: ${options.table}`);
    const result = await importData(db, options.table, data);
    console.log(`Import completed: ${result.inserted} inserted, ${result.updated} updated`);
    
    // Output result
    const output = {
      status: 'success',
      message: `Successfully processed ${result.total} records in ${result.duration.toFixed(3)} seconds`,
      table: options.table,
      database: options.database,
      inserted: result.inserted,
      updated: result.updated,
      skipped: result.skipped,
      failed: result.failed,
      total: result.total,
      duration: `${result.duration.toFixed(3)}s`
    };
    
    if (options.output === 'stdout') {
      console.log(JSON.stringify(output, null, 2));
    } else if (options.output === 'json') {
      fs.writeFileSync('import_result.json', JSON.stringify(output, null, 2));
      console.log('Results written to import_result.json');
    }
    
    // Close database connection
    console.log('Closing database connection...');
    await db.destroy();
    console.log('Database connection closed');
    
    // Clean up temp file if created
    if (isTemporaryFile && fs.existsSync(inputFile)) {
      console.log('Cleaning up temporary files...');
      fs.unlinkSync(inputFile);
      console.log('Temporary files removed');
    }
    
    process.exit(0);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    throw error;
    // process.exit(1);
  }
};

// Run the application
main();