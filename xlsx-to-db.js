const fs = require('fs');
// const path = require('path');
const { program } = require('commander');
const xlsx = require('xlsx');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const axios = require('axios');
const tmp = require('tmp');
const { performance } = require('perf_hooks');
const winston = require('winston');

// Configure logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ level, message, timestamp }) => {
      return `${timestamp} ${level}: ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'xlsx-to-db.log' })
  ]
});

// Configure CLI options
program
  .name('xlsx-to-db')
  .description('Import XLSX file to a SQLite database')
  .version('1.0.0')
  .option('-i, --input <path>', 'Path to local XLSX file or URL to Google Sheets')
  .option('-d, --database <path>', 'Path to SQLite database (default: people.db)', 'people.db')
  .option('-t, --table <name>', 'Table name to create (default: people)', 'people')
  .option('-v, --verbose', 'Enable verbose logging')
  .parse(process.argv);

const options = program.opts();

// Set log level based on verbose flag
if (options.verbose) {
  logger.level = 'debug';
}

/**
 * Main function to execute the import process
 */
async function main() {
  const startTime = performance.now();
  logger.info('Starting XLSX to database import process');
  
  try {
    // Validate input
    if (!options.input) {
      throw new Error('Input file path or URL is required');
    }

    // Load workbook from local file or URL
    const workbook = await loadWorkbook(options.input);
    if (!workbook) {
      throw new Error('Failed to load workbook');
    }
    
    // Process workbook and get data
    const data = processWorkbook(workbook);
    logger.info(`Processed ${data.length} records from the workbook`);
    
    // Create and populate database
    await createAndPopulateDatabase(data, options.database, options.table);
    
    const endTime = performance.now();
    const executionTime = ((endTime - startTime) / 1000).toFixed(2);
    
    logger.info(`Import completed successfully in ${executionTime} seconds`);
    console.log(JSON.stringify({
      status: 'success',
      recordsImported: data.length,
      executionTimeSeconds: executionTime,
      database: options.database,
      table: options.table
    }));
    
  } catch (error) {
    logger.error(`Error during import: ${error.message}`);
    console.error(JSON.stringify({
      status: 'error',
      message: error.message
    }));
    process.exit(1);
  }
}

/**
 * Load workbook from local file or URL
 * @param {string} input - Local file path or URL
 * @returns {Promise<xlsx.WorkBook>} - XLSX workbook
 */
async function loadWorkbook(input) {
  try {
    // Check if input is a URL (simple check for http/https)
    if (input.startsWith('http://') || input.startsWith('https://')) {
      logger.debug(`Loading workbook from URL: ${input}`);
      return await loadWorkbookFromUrl(input);
    } else {
      logger.debug(`Loading workbook from local file: ${input}`);
      return loadWorkbookFromFile(input);
    }
  } catch (error) {
    throw new Error(`Failed to load workbook: ${error.message}`);
  }
}

/**
 * Load workbook from local file
 * @param {string} filePath - Path to local XLSX file
 * @returns {xlsx.WorkBook} - XLSX workbook
 */
function loadWorkbookFromFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    return xlsx.readFile(filePath);
  } catch (error) {
    throw new Error(`Error reading local file: ${error.message}`);
  }
}

/**
 * Load workbook from URL
 * @param {string} url - URL to XLSX file
 * @returns {Promise<xlsx.WorkBook>} - XLSX workbook
 */
async function loadWorkbookFromUrl(url) {
  try {
    // Create temporary file
    const tmpFile = tmp.fileSync({ postfix: '.xlsx' });
    
    // Download file
    logger.debug(`Downloading file from ${url} to ${tmpFile.name}`);
    const response = await axios({
      method: 'get',
      url: url,
      responseType: 'arraybuffer'
    });
    
    // Write to temporary file
    fs.writeFileSync(tmpFile.name, response.data);
    
    // Read workbook
    const workbook = xlsx.readFile(tmpFile.name);
    
    // Clean up temporary file
    tmpFile.removeCallback();
    
    return workbook;
  } catch (error) {
    throw new Error(`Error fetching file from URL: ${error.message}`);
  }
}

/**
 * Process workbook and extract data
 * @param {xlsx.WorkBook} workbook - XLSX workbook
 * @returns {Array} - Array of data objects
 */
function processWorkbook(workbook) {
  try {
    // Get first sheet
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // Convert to JSON
    const data = xlsx.utils.sheet_to_json(worksheet);
    
    // Validate data structure
    if (!data || data.length === 0) {
      throw new Error('No data found in the worksheet');
    }
    
    // Check if required columns exist in first row
    const requiredColumns = ['matricule', 'nom', 'prenom', 'datedenaissance', 'status'];
    const firstRow = data[0];
    
    for (const column of requiredColumns) {
      if (!(column in firstRow)) {
        throw new Error(`Required column "${column}" is missing in the spreadsheet`);
      }
    }
    
    return data;
  } catch (error) {
    throw new Error(`Error processing workbook: ${error.message}`);
  }
}

/**
 * Create database and table, then insert data
 * @param {Array} data - Array of data objects
 * @param {string} dbPath - Path to SQLite database
 * @param {string} tableName - Table name to create
 * @returns {Promise<void>}
 */
async function createAndPopulateDatabase(data, dbPath, tableName) {
  let db;
  try {
    // Open database connection
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database
    });
    
    logger.debug(`Connected to database: ${dbPath}`);
    
    // Start transaction
    await db.run('BEGIN TRANSACTION');
    
    // Create table based on the first data row
    const firstRow = data[0];
    const columns = Object.keys(firstRow);
    
    const columnDefinitions = columns.map(column => {
      // Determine column type based on first row values
      const value = firstRow[column];
      let type = 'TEXT';
      
      if (typeof value === 'number') {
        if (Number.isInteger(value)) {
          type = 'INTEGER';
        } else {
          type = 'REAL';
        }
      } else if (typeof value === 'boolean') {
        type = 'BOOLEAN';
      }
      
      return `"${column}" ${type}`;
    });
    
    // Add primary key to matricule column
    columnDefinitions[columns.indexOf('matricule')] = '"matricule" TEXT PRIMARY KEY';
    
    // Create table query
    const createTableQuery = `CREATE TABLE IF NOT EXISTS "${tableName}" (${columnDefinitions.join(', ')})`;
    logger.debug(`Creating table with query: ${createTableQuery}`);
    await db.run(createTableQuery);
    
    // Prepare insert statement
    const placeholders = columns.map(() => '?').join(', ');
    const insertQuery = `INSERT OR REPLACE INTO "${tableName}" (${columns.map(c => `"${c}"`).join(', ')}) VALUES (${placeholders})`;
    const stmt = await db.prepare(insertQuery);
    
    // Insert data
    for (const row of data) {
      const values = columns.map(column => row[column]);
      await stmt.run(values);
    }
    
    // Finalize statement
    await stmt.finalize();
    
    // Commit transaction
    await db.run('COMMIT');
    
    logger.info(`Successfully inserted ${data.length} records into table "${tableName}"`);
  } catch (error) {
    // Rollback transaction on error
    if (db) {
      await db.run('ROLLBACK');
    }
    throw new Error(`Database error: ${error.message}`);
  } finally {
    // Close database connection
    if (db) {
      await db.close();
    }
  }
}

// Execute main function
main();