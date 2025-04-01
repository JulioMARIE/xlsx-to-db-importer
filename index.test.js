const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const { exec } = require('child_process');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const mockFs = require('mock-fs');
const nock = require('nock');

// Helper function to create test XLSX file
function createTestXlsxFile(filePath) {
  // Create a simple workbook with test data
  const workbook = xlsx.utils.book_new();
  const data = [
    { matricule: 'TEST001', nom: 'Doe', prenom: 'John', datedenaissance: '1980-01-01', status: 'Actif' },
    { matricule: 'TEST002', nom: 'Smith', prenom: 'Jane', datedenaissance: '1985-05-15', status: 'Inactif' }
  ];
  const worksheet = xlsx.utils.json_to_sheet(data);
  xlsx.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  xlsx.writeFile(workbook, filePath);
}

// Helper function to execute the CLI
function execCli(args) {
  return new Promise((resolve, reject) => {
    exec(`node xlsx-to-db.js ${args}`, (error, stdout, stderr) => {
      if (error) {
        reject({ error, stderr });
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

// Helper function to check database contents
async function checkDatabase(dbPath, tableName, expectedCount) {
  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });
  
  const count = await db.get(`SELECT COUNT(*) as count FROM ${tableName}`);
  await db.close();
  
  return count.count;
}

describe('XLSX to Database CLI', () => {
  const testXlsxPath = 'test-data.xlsx';
  const testDbPath = 'test.db';
  
  beforeAll(() => {
    // Create test XLSX file
    createTestXlsxFile(testXlsxPath);
  });
  
  afterAll(() => {
    // Clean up test files
    if (fs.existsSync(testXlsxPath)) {
      fs.unlinkSync(testXlsxPath);
    }
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });
  
  afterEach(() => {
    // Clean up mocks
    nock.cleanAll();
    try {
      mockFs.restore();
    } catch (e) {
      // Ignore if mockFs wasn't active
    }
  });
  
  test('should import local XLSX file to database', async () => {
    const result = await execCli(`--input ${testXlsxPath} --database ${testDbPath}`);
    const output = JSON.parse(result.stdout);
    
    expect(output.status).toBe('success');
    expect(output.recordsImported).toBe(2);
    
    const count = await checkDatabase(testDbPath, 'people', 2);
    expect(count).toBe(2);
  });
  
  test('should fail with appropriate error for non-existent file', async () => {
    try {
      await execCli('--input non-existent-file.xlsx');
      fail('Should have thrown an error');
    } catch (error) {
      const output = JSON.parse(error.stderr);
      expect(output.status).toBe('error');
      expect(output.message).toContain('Error reading local file: File not found');
    }
  });
  
  test('should import from URL', async () => {
    // Mock HTTP request
    nock('https://example.com')
      .get('/test.xlsx')
      .replyWithFile(200, testXlsxPath, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
    
    const result = await execCli(`--input https://example.com/test.xlsx --database ${testDbPath}`);
    const output = JSON.parse(result.stdout);
    
    expect(output.status).toBe('success');
    expect(output.recordsImported).toBe(2);
  });
  
  test('should use custom table name', async () => {
    const customTable = 'custom_table';
    const result = await execCli(`--input ${testXlsxPath} --database ${testDbPath} --table ${customTable}`);
    const output = JSON.parse(result.stdout);
    
    expect(output.status).toBe('success');
    expect(output.table).toBe(customTable);
    
    const count = await checkDatabase(testDbPath, customTable, 2);
    expect(count).toBe(2);
  });
  
  test('should validate required columns', async () => {
    // Create invalid XLSX file without required columns
    const invalidXlsxPath = 'invalid-test.xlsx';
    const workbook = xlsx.utils.book_new();
    const data = [
      { id: '1', missing_required_columns: true }
    ];
    const worksheet = xlsx.utils.json_to_sheet(data);
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    xlsx.writeFile(workbook, invalidXlsxPath);
    
    try {
      await execCli(`--input ${invalidXlsxPath} --database ${testDbPath}`);
      fail('Should have thrown an error');
    } catch (error) {
      const output = JSON.parse(error.stderr);
      expect(output.status).toBe('error');
      expect(output.message).toContain('Required column');
    } finally {
      if (fs.existsSync(invalidXlsxPath)) {
        fs.unlinkSync(invalidXlsxPath);
      }
    }
  });
});

// const fs = require('fs');
// const path = require('path');
// const { execSync } = require('child_process');
// const knex = require('knex');
// const xlsx = require('xlsx');

// // Test database configuration
// const testDbConfig = {
//   client: 'sqlite3',
//   connection: {
//     filename: ':memory:'
//   },
//   useNullAsDefault: true
// };

// // Create test XLSX file
// const createTestXlsxFile = () => {
//   const testData = [
//     {
//       matricule: 'TEST001',
//       nom: 'Doe',
//       prenom: 'John',
//       datedenaissance: '1990-01-01',
//       status: 'Actif'
//     },
//     {
//       matricule: 'TEST002',
//       nom: 'Smith',
//       prenom: 'Jane',
//       datedenaissance: '25/12/1985',
//       status: 'Inactif'
//     },
//     {
//       matricule: 'TEST003',
//       nom: 'Johnson',
//       prenom: 'Bob',
//       datedenaissance: '03-05-1975',
//       status: 'En attente'
//     }
//   ];

//   // Create worksheet
//   const ws = xlsx.utils.json_to_sheet(testData);
//   const wb = xlsx.utils.book_new();
//   xlsx.utils.book_append_sheet(wb, ws, 'TestData');

//   // Write to file
//   const filePath = path.join(__dirname, 'test_data.xlsx');
//   xlsx.writeFile(wb, filePath);

//   return filePath;
// };

// // Clean up function
// const cleanup = (filePath) => {
//   if (fs.existsSync(filePath)) {
//     fs.unlinkSync(filePath);
//   }
// };

// describe('XLSX to DB Importer', () => {
//   let testFilePath;
//   let db;

//   beforeAll(() => {
//     // Create test XLSX file
//     testFilePath = createTestXlsxFile();

//     // Initialize test database
//     db = knex(testDbConfig);
//   });

//   afterAll(async () => {
//     // Clean up test file
//     cleanup(testFilePath);

//     // Close database connection
//     await db.destroy();
//   });

//   test('Application successfully imports XLSX data', async () => {
//     // Run the application with test file
//     const result = execSync(
//       `node index.js --input ${testFilePath} --database sqlite --create-table`,
//       { encoding: 'utf8' }
//     );

//     // Parse the result
//     const parsedResult = JSON.parse(result);

//     // Assertions
//     expect(parsedResult.status).toBe('success');
//     expect(parsedResult.records).toBe(3);
//     expect(parsedResult.table).toBe('persons');
//     expect(parsedResult.database).toBe('sqlite');
//     expect(parsedResult).toHaveProperty('duration');
//   });

//   test('Application handles different date formats', async () => {
//     // Create a database connection
//     await db.schema.createTable('persons', (table) => {
//       table.increments('id').primary();
//       table.string('matricule').unique();
//       table.string('nom');
//       table.string('prenom');
//       table.date('datedenaissance');
//       table.string('status');
//       table.timestamps(true, true);
//     });

//     // Run the application with test file
//     execSync(
//       `node index.js --input ${testFilePath} --database sqlite --table persons --create-table`,
//       { encoding: 'utf8' }
//     );

//     // Query the data
//     const records = await db('persons').select('*');

//     // Assertions
//     expect(records.length).toBe(3);
    
//     // Check date standardization
//     const dateFormats = records.map(r => r.datedenaissance);
//     expect(dateFormats).toContain('1990-01-01');
    
//     // The different date formats should be standardized to YYYY-MM-DD
//     expect(dateFormats.every(date => /^\d{4}-\d{2}-\d{2}$/.test(date))).toBe(true);
//   });

//   test('Application validates input data', () => {
//     // Create an invalid XLSX file
//     const invalidFilePath = path.join(__dirname, 'invalid_test_data.xlsx');
//     const ws = xlsx.utils.aoa_to_sheet([['Invalid', 'Headers']]);
//     const wb = xlsx.utils.book_new();
//     xlsx.utils.book_append_sheet(wb, ws, 'InvalidData');
//     xlsx.writeFile(wb, invalidFilePath);

//     try {
//       // This should throw an error due to missing required columns
//       execSync(
//         `node index.js --input ${invalidFilePath} --database sqlite --create-table`,
//         { encoding: 'utf8' }
//       );
      
//       // If we get here, the test should fail
//       expect(true).toBe(false);
//     } catch (error) {
//       // We expect an error
//       expect(error).toBeTruthy();
//     } finally {
//       // Clean up
//       cleanup(invalidFilePath);
//     }
//   });
// });