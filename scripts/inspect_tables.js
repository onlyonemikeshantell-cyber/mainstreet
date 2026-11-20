const db = require('../src/db');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(t => t.name);
console.log('Total tables in DB:', tables.length);
console.log('Tables:', tables);

const { TABLES_TO_SYNC } = require('../src/services/cloudPersistenceService');
// In cloudPersistenceService TABLES_TO_SYNC is not exported currently, let's read it
console.log('Checking which tables exist in DB vs TABLES_TO_SYNC...');
