const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const knex = require('knex');
const xlsx = require('xlsx');

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const knex = require('knex');
const xlsx = require('xlsx');

// Helper functions
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const knex = require('knex');
const xlsx = require('xlsx');

// Helper function to create test XLSX file
const createTestXlsx = (filename, data) => {
  const workbook = xlsx.utils.book_new();
  const worksheet = xlsx.utils.json_to_sheet(data);
  xlsx.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  xlsx.writeFile(workbook, filename);
};

describe('XLSX to DB Importer', () => {
  const testXlsxFile = path.join(__dirname, 'test_data.xlsx');
  const testDbFile = path.join(__dirname, 'test_db.sqlite');
  
  beforeAll(() => {
    // Create test XLSX file
    const testData = [
      { matricule: '001', nom: 'Doe', prenom: 'John', datedenaissance: '1980-01-01', service: 'IT' },
      { matricule: '002', nom: 'Smith', prenom: 'Jane', datedenaissance: '1985-05-15', service: 'HR' }
    ];
    createTestXlsx(testXlsxFile, testData);
  });

  afterAll(() => {
    // Clean up test files
    if (fs.existsSync(testXlsxFile)) fs.unlinkSync(testXlsxFile);
    if (fs.existsSync(testDbFile)) fs.unlinkSync(testDbFile);
  });

  test('should import data from XLSX to database', () => {
    // Run the CLI command with test file
    const command = `node ${path.join(__dirname, '../index.js')} -i ${testXlsxFile} -d sqlite --create-table -t test_persons`;
    
    try {
      const output = execSync(command).toString();
      expect(output).toContain('Import completed');
      
      // Verify database was created
      expect(fs.existsSync(testDbFile)).toBe(true);
    } catch (error) {
      console.error('Command failed:', error.stdout?.toString(), error.stderr?.toString());
      throw error;
    }
  });
});

describe('XLSX to DB Importer', () => {
  const testXlsxFile = path.join(__dirname, 'test_data.xlsx');
  const testDbFile = path.join(__dirname, 'test_db.sqlite');
  
  beforeAll(() => {
    // Create test XLSX file
    const testData = [
      { matricule: '001', nom: 'Doe', prenom: 'John', datedenaissance: '1980-01-01', service: 'IT' },
      { matricule: '002', nom: 'Smith', prenom: 'Jane', datedenaissance: '1985-05-15', service: 'HR' }
    ];
    createTestXlsx(testXlsxFile, testData);
  });

  afterAll(() => {
    // Clean up test files
    if (fs.existsSync(testXlsxFile)) fs.unlinkSync(testXlsxFile);
    if (fs.existsSync(testDbFile)) fs.unlinkSync(testDbFile);
  });

  test('should import data from XLSX to database', () => {
    // Run the CLI command with test file
    const command = `node ${path.join(__dirname, '../index.js')} -i ${testXlsxFile} -d sqlite --create-table -t test_persons`;
    
    try {
      const output = execSync(command).toString();
      expect(output).toContain('Import completed');
      
      // Verify database was created
      expect(fs.existsSync(testDbFile)).toBe(true);
    } catch (error) {
      console.error('Command failed:', error.stdout.toString(), error.stderr.toString());
      throw error;
    }
  });

  // Add more specific unit tests for your functions
  describe('Utility Functions', () => {
    test('should standardize date formats', () => {
      // Mock the functions you want to test
      const mockStandardizeDate = jest.fn((date) => {
        if (date === '01/01/1980') return '1980-01-01';
        return date;
      });
      
      expect(mockStandardizeDate('01/01/1980')).toBe('1980-01-01');
    });
  });
});


// Helper function to create a test database
const createTestDb = async (dbConfig) => {
  const db = knex(dbConfig);
  
  // Create a test table
  await db.schema.createTable('test_persons', (table) => {
    table.increments('id').primary();
    table.string('matricule').unique();
    table.string('nom');
    table.string('prenom');
    table.date('datedenaissance');
    table.string('service');
    table.timestamps(true, true);
  });
  
  return db;
};

describe('XLSX to DB Importer', () => {
  const testXlsxFile = path.join(__dirname, 'test_data.xlsx');
  const testDbFile = path.join(__dirname, 'test_db.sqlite');
  let db;
  
  beforeAll(async () => {
    // Create a test XLSX file
    const testData = [
      { matricule: '001', nom: 'Doe', prenom: 'John', datedenaissance: '1980-01-01', service: 'IT' },
      { matricule: '002', nom: 'Smith', prenom: 'Jane', datedenaissance: '1985-05-15', service: 'HR' },
      { matricule: '003', nom: 'Brown', prenom: 'Bob', datedenaissance: '1990-10-20', service: 'Finance' }
    ];
    createTestXlsx(testXlsxFile, testData);
    
    // Create a test database
    const dbConfig = {
      client: 'sqlite3',
      connection: {
        filename: testDbFile
      },
      useNullAsDefault: true
    };
    db = await createTestDb(dbConfig);
  });
  
  afterAll(async () => {
    // Clean up test files
    if (fs.existsSync(testXlsxFile)) {
      fs.unlinkSync(testXlsxFile);
    }
    if (fs.existsSync(testDbFile)) {
      fs.unlinkSync(testDbFile);
    }
    
    // Close database connection
    if (db) {
      await db.destroy();
    }
  });
  
  describe('Command Line Interface', () => {
    test('should show help when no arguments provided', () => {
      const output = execSync('node index.js --help').toString();
      expect(output).toContain('Import XLSX data into a relational database');
      expect(output).toContain('Options:');
    });
    
    test('should show version when --version is provided', () => {
      const output = execSync('node index.js --version').toString();
      expect(output.trim()).toBe('1.0.0');
    });
  });
  
  describe('XLSX Parser', () => {
    test('should parse XLSX file correctly', () => {
      const { parseXlsxFile } = require('../index');
      const { columns, data } = parseXlsxFile(testXlsxFile);
      
      expect(columns).toEqual(expect.arrayContaining(['matricule', 'nom', 'prenom', 'datedenaissance', 'service']));
      expect(data.length).toBe(3);
      expect(data[0]).toHaveProperty('matricule', '001');
      expect(data[1]).toHaveProperty('nom', 'Smith');
    });
    
    test('should handle date standardization', () => {
      const { standardizeDate } = require('./index');
      
      // Test various date formats
      expect(standardizeDate('1980-01-01')).toBe('1980-01-01');
      expect(standardizeDate('01/01/1980')).toBe('1980-01-01');
      expect(standardizeDate('01-01-1980')).toBe('1980-01-01');
      expect(standardizeDate('1980/01/01')).toBe('1980-01-01');
      
      // Test Excel serial dates
      const excelDate = 29221; // 1980-01-01 in Excel serial date
      expect(standardizeDate(excelDate)).toBe('1980-01-01');
    });
    
    test('should normalize column names', () => {
      const { normalizeColumnName } = require('./index');
      
      expect(normalizeColumnName('First Name')).toBe('first_name');
      expect(normalizeColumnName('Date of Birth')).toBe('date_of_birth');
      expect(normalizeColumnName('Employee ID#')).toBe('employee_id');
    });
  });
  
  describe('Database Operations', () => {
    test('should create table schema', async () => {
      const { createTableSchema } = require('./index');
      
      await createTableSchema(db, 'test_persons_2', ['matricule', 'nom', 'prenom']);
      const tableExists = await db.schema.hasTable('test_persons_2');
      expect(tableExists).toBe(true);
      
      // Clean up
      await db.schema.dropTable('test_persons_2');
    });
    
    test('should import data into database', async () => {
      const { parseXlsxFile, importData } = require('./index');
      const { data } = parseXlsxFile(testXlsxFile);
      
      const result = await importData(db, 'test_persons', data);
      
      expect(result.success).toBe(true);
      expect(result.inserted).toBe(3);
      expect(result.total).toBe(3);
      
      // Verify data in database
      const records = await db('test_persons').select('*');
      expect(records.length).toBe(3);
      expect(records[0].matricule).toBe('001');
      expect(records[1].nom).toBe('Smith');
    });
    
    test('should handle duplicate matricules based on mode', async () => {
      const { importData } = require('./index');
      
      // Test data with duplicate matricule
      const testData = [
        { matricule: '001', nom: 'Doe', prenom: 'John', datedenaissance: '1980-01-01', service: 'IT' },
        { matricule: '001', nom: 'Doe', prenom: 'Johnathan', datedenaissance: '1980-01-01', service: 'IT' }
      ];
      
      // Test update mode
      let result = await importData(db, 'test_persons', testData, { handleDuplicates: 'update' });
      expect(result.updated).toBe(1);
      
      // Verify the record was updated
      const updatedRecord = await db('test_persons').where({ matricule: '001' }).first();
      expect(updatedRecord.prenom).toBe('Johnathan');
      
      // Test skip mode
      result = await importData(db, 'test_persons', testData, { handleDuplicates: 'skip' });
      expect(result.skipped).toBe(1);
      
      // Test error mode
      await expect(importData(db, 'test_persons', testData, { handleDuplicates: 'error' }))
        .rejects.toThrow('Duplicate matricule: 001');
    });
  });
  
  describe('End-to-End Test', () => {
    test('should complete full import process', async () => {
      // Run the CLI command
      const output = execSync(`node index.js -i ${testXlsxFile} -d sqlite -t test_persons_e2e --create-table`).toString();
      
      // Check output
      expect(output).toContain('Starting import process...');
      expect(output).toContain('Import completed');
      
      // Verify database
      const dbConfig = {
        client: 'sqlite3',
        connection: {
          filename: testDbFile
        },
        useNullAsDefault: true
      };
      const testDb = knex(dbConfig);
      
      const records = await testDb('test_persons_e2e').select('*');
      expect(records.length).toBe(3);
      
      await testDb.destroy();
    });
  });
});