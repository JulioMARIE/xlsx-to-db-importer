const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const knex = require('knex');
const xlsx = require('xlsx');

// Check if a custom file path was provided
const useCustomFile = process.env.FILE_PATH && fs.existsSync(process.env.FILE_PATH);
const customFilePath = useCustomFile ? process.env.FILE_PATH : null;

// Create test XLSX file with proper headers and data
const createTestXlsxFile = () => {
  // If a custom file path was provided, use that instead
  if (useCustomFile) {
    console.log(`Using custom test file: ${customFilePath}`);
    return customFilePath;
  }

  // Create data with headers first, then rows
  const testData = [
    ['Matricule', 'Nom', 'Prenom', 'DateDeNaissance', 'Status'],
    ['TEST001', 'Doe', 'John', '1990-01-01', 'Actif'],
    ['TEST002', 'Smith', 'Jane', '25/12/1985', 'Inactif'],
    ['TEST003', 'Johnson', 'Bob', '03-05-1975', 'En attente']
  ];

  // Create worksheet from array of arrays
  const ws = xlsx.utils.aoa_to_sheet(testData);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, 'TestData');

  // Write to file
  const filePath = path.join(process.cwd(), 'test_data.xlsx');
  xlsx.writeFile(wb, filePath);
  console.log(`Created test file at: ${filePath}`);

  return filePath;
};

// Clean up function
const cleanup = (filePath) => {
  // Don't delete custom provided files
  if (filePath === customFilePath) {
    console.log(`Keeping custom test file: ${filePath}`);
    return;
  }

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    console.log(`Removed test file: ${filePath}`);
  }
};

describe('XLSX to DB Importer', () => {
  let testFilePath;
  let db;
  let dbFilePath;

  beforeAll(async () => {
    // Create test XLSX file
    testFilePath = createTestXlsxFile();

    // Create a temporary database file
    dbFilePath = path.join(process.cwd(), 'test_database.sqlite');
    
    // Initialize test database
    db = knex({
      client: 'sqlite3',
      connection: {
        filename: dbFilePath
      },
      useNullAsDefault: true
    });
  });

  afterAll(async () => {
    // Clean up test files
    cleanup(testFilePath);
    
    // Close database connection
    await db.destroy();
    
    // Remove database file
    if (fs.existsSync(dbFilePath)) {
      fs.unlinkSync(dbFilePath);
      console.log(`Removed database file: ${dbFilePath}`);
    }
  });

  test('Application successfully imports XLSX data', async () => {
    // Run the application with test file
    try {
      const result = execSync(
        `node index.js --input ${testFilePath} --database sqlite --create-table --table persons`,
        { encoding: 'utf8' }
      );
      
      console.log("Command output:", result);
      
      // Check if output contains success message
      expect(result).toContain('Successfully processed');
      expect(result).toContain('status": "success');
      
      // Check database content
      // const records = await db('persons').select('*');
      // expect(records.length).toBeGreaterThan(0);
    } catch (error) {
      console.error("Command execution failed:", error.message);
      console.error("Command stderr:", error.stderr);
      // Replace fail() with expect().toBe() for better error reporting
      expect(error).toBeFalsy(`Command execution failed: ${error.message}`);
    }
  });

  test('Application validates input data', () => {
    // Skip this test if we're using a custom file
    if (useCustomFile) {
      console.log('Skipping validation test when using custom file');
      return;
    }

    // Create an invalid XLSX file with only headers and no data
    const invalidFilePath = path.join(process.cwd(), 'invalid_test_data.xlsx');
    const ws = xlsx.utils.aoa_to_sheet([['Invalid', 'Headers']]);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'InvalidData');
    xlsx.writeFile(wb, invalidFilePath);

    try {
      // This should throw an error due to missing data
      execSync(
        `node index.js --input ${invalidFilePath} --database sqlite --create-table`,
        { encoding: 'utf8', stdio: 'pipe' }
      );
      
      // If we get here, the test should fail
      expect(false).toBe(true, 'Expected an error but none was thrown');
    } catch (error) {
      // We expect an error
      expect(error.status).not.toBe(0);
      expect(error.stderr.toString()).toContain('No data found in the XLSX file');
    } finally {
      // Clean up
      cleanup(invalidFilePath);
    }
  });
});