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