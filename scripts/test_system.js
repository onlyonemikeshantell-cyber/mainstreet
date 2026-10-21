// Mainstreet Capital Exchange - Comprehensive System & Health Verification Test
const db = require('../src/db');
const { getLivePrices } = require('../src/services/livePriceService');
const { startWorkers, stopWorkers } = require('../src/workers/tradingWorkers');
const fs = require('fs');
const path = require('path');

console.log('--- Starting Mainstreet System Verification ---');

// 1. Verify Database
try {
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  const marketCount = db.prepare('SELECT COUNT(*) as count FROM market_settings').get().count;
  const tradeCount = db.prepare('SELECT COUNT(*) as count FROM trades').get().count;
  const walletCount = db.prepare('SELECT COUNT(*) as count FROM user_connected_wallets').get().count;
  console.log(`[PASS] Database Connected. Users: ${userCount}, Tradable Assets: ${marketCount}, Trades: ${tradeCount}, Connected Wallets: ${walletCount}`);
} catch (err) {
  console.error('[FAIL] Database error:', err.message);
  process.exit(1);
}

// 2. Verify Key Views Exist
const viewsToCheck = [
  'views/public/home.ejs',
  'views/auth/login.ejs',
  'views/auth/register.ejs',
  'views/app/dashboard.ejs',
  'views/app/wallet.ejs',
  'views/app/deposit.ejs',
  'views/app/admin.ejs',
  'views/errors/404.ejs'
];
viewsToCheck.forEach(v => {
  const fullPath = path.join(__dirname, '..', 'src', v);
  if (!fs.existsSync(fullPath)) {
    console.error(`[FAIL] Missing view: ${v}`);
    process.exit(1);
  }
});
console.log(`[PASS] All ${viewsToCheck.length} core views verified on disk.`);

// 3. Verify Live Price Service
try {
  const prices = getLivePrices();
  if (prices && (prices['BTC'] || prices['ETH'])) {
    console.log(`[PASS] Live Price Service Active. BTC: $${prices['BTC']?.price || 'N/A'}, ETH: $${prices['ETH']?.price || 'N/A'}`);
  } else {
    console.warn('[WARN] Live prices returned empty or fallback object.');
  }
} catch (err) {
  console.error('[FAIL] Price service error:', err.message);
  process.exit(1);
}

// 4. Verify Workers Initialization
try {
  startWorkers(db);
  stopWorkers();
  console.log('[PASS] Trading background workers initialize and stop cleanly.');
} catch (err) {
  console.error('[FAIL] Worker initialization error:', err.message);
  process.exit(1);
}

console.log('--- ALL SYSTEM VERIFICATION CHECKS PASSED ---');
process.exit(0);
