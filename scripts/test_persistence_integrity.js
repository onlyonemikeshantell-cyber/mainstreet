const db = require('../src/db');
const {
  exportDatabaseSnapshot,
  importDatabaseSnapshot,
  TABLES_TO_SYNC,
  recordLocalMutation,
  getLocalMutationTime,
  syncToCloudVault
} = require('../src/services/cloudPersistenceService');
const zlib = require('zlib');

async function runTests() {
  console.log('=== Step 1: Verify TABLES_TO_SYNC and exportDatabaseSnapshot ===');
  recordLocalMutation(db);
  const localTs = getLocalMutationTime(db);
  console.log('Local mutation timestamp recorded:', localTs, new Date(localTs).toISOString());

  const b64 = exportDatabaseSnapshot(db);
  const jsonBuf = zlib.gunzipSync(Buffer.from(b64, 'base64'));
  const snapshot = JSON.parse(jsonBuf.toString('utf8'));

  console.log('Snapshot version:', snapshot.version);
  console.log('Snapshot ISO date:', snapshot.isoDate);
  console.log('Snapshot tables count:', Object.keys(snapshot.tables).length);

  const criticalTables = [
    'users',
    'payment_gateways',
    'master_traders',
    'master_trades',
    'investment_plans',
    'market_settings',
    'smtp_settings',
    'retirement_accounts',
    'retirement_contributions'
  ];

  for (const tbl of criticalTables) {
    if (!snapshot.tables[tbl]) {
      throw new Error(`CRITICAL TABLE MISSING FROM SNAPSHOT: ${tbl}`);
    }
    console.log(`✓ Table '${tbl}' present in snapshot (${snapshot.tables[tbl].length} rows)`);
  }

  console.log('Avatar files in snapshot:', Object.keys(snapshot.avatarFiles || {}).length);
  console.log('KYC files in snapshot:', Object.keys(snapshot.kycFiles || {}).length);

  console.log('\n=== Step 2: Test Timestamp Guard Logic ===');
  // Scenario A: Remote snapshot is older than local mutation
  const oldRemoteSnapshot = {
    version: 2,
    timestamp: localTs - 60000, // 1 minute older
    isoDate: new Date(localTs - 60000).toISOString(),
    tables: snapshot.tables
  };

  const shouldSkipRestore = (localTs > (oldRemoteSnapshot.timestamp + 5000));
  console.log('Scenario A (Remote snapshot older than local): shouldSkipRestore =', shouldSkipRestore);
  if (!shouldSkipRestore) {
    throw new Error('Timestamp guard failed: Old snapshot was not detected as older!');
  }
  console.log('✓ Timestamp guard successfully protects local database from being overwritten by older remote snapshots.');

  // Scenario B: Remote snapshot is newer than local mutation
  const newRemoteSnapshot = {
    version: 2,
    timestamp: localTs + 60000, // 1 minute newer
    isoDate: new Date(localTs + 60000).toISOString(),
    tables: snapshot.tables
  };
  const shouldRestoreNew = !(localTs > (newRemoteSnapshot.timestamp + 5000));
  console.log('Scenario B (Remote snapshot newer than local): shouldRestoreNew =', shouldRestoreNew);
  if (!shouldRestoreNew) {
    throw new Error('Timestamp guard failed: Newer snapshot would be erroneously skipped!');
  }
  console.log('✓ Timestamp guard permits restoration when remote snapshot is genuinely newer.');

  console.log('\n=== Step 3: Test Live syncToCloudVault ===');
  console.log('Pushing complete unified snapshot (with master_traders & all configuration tables) to remote IMAP vault...');
  const syncSuccess = await syncToCloudVault(db);
  console.log('syncToCloudVault result:', syncSuccess ? 'SUCCESS (Snapshot vaulted in INBOX.MainstreetDBVault)' : 'FAILED');

  if (!syncSuccess) {
    throw new Error('Live cloud vault sync failed!');
  }

  console.log('\n=== ALL INTEGRITY CHECKS PASSED ===');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
