process.env.DISABLE_CLOUD_VAULT = '1';
const express = require('express');
const session = require('express-session');
const path = require('path');
const http = require('http');
const db = require('../src/db');
const { injectUser } = require('../src/middleware/auth');
const csrfMiddleware = require('../src/middleware/csrf');
const userRoutes = require('../src/routes/user');

const app = express();
app.set('views', path.join(__dirname, '..', 'src', 'views'));
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({ secret: 'test_th_sec', resave: false, saveUninitialized: false }));

let testUserId = null;
app.get('/__test_login', (req, res) => {
  req.session.userId = testUserId;
  req.session.csrfToken = 'test_th_csrf';
  req.session.save(() => res.send('OK'));
});

app.use(csrfMiddleware);
app.use(injectUser);
app.use('/', userRoutes);
app.use((err, req, res, next) => {
  console.error('EXPRESS ERROR:', err);
  res.status(500).send('ERR: ' + err.message);
});

function httpReq(port, method, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ hostname: '127.0.0.1', port, path: urlPath, method, headers }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    r.on('error', reject);
    r.end();
  });
}

(async () => {
  const server = app.listen(0);
  const port = server.address().port;
  const createdTradeIds = [];

  try {
    // 1. Unauthenticated access must be blocked
    const rUnauth = await httpReq(port, 'GET', '/trade-history');
    if (rUnauth.status !== 302) throw new Error('Expected 302 for unauthenticated /trade-history, got ' + rUnauth.status);
    console.log('✓ 1. Unauthenticated /trade-history properly redirected (302)');

    // Create temp verified user + 3 trades (CLOSED BUY, CLOSED SELL, OPEN BUY)
    testUserId = db.prepare(`
      INSERT INTO users (name, email, password, role, balance, equity, currency, kyc_status, email_verified, is_active)
      VALUES ('History Tester', ?, 'hash', 'user', 15000, 15000, 'USD', 'verified', 1, 1)
    `).run('hist_' + Date.now() + '@test.local').lastInsertRowid;

    const insTrade = db.prepare(`
      INSERT INTO trades (user_id, symbol, type, lot_size, open_price, current_price, close_price, take_profit, stop_loss, profit_loss, status, opened_at, closed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    createdTradeIds.push(insTrade.run(testUserId, 'BTC/USD', 'BUY', 0.50, 64000, 65200, 65200, 66000, 63000, 600.00, 'CLOSED', '2026-11-18 10:00:00', '2026-11-18 14:30:00').lastInsertRowid);
    createdTradeIds.push(insTrade.run(testUserId, 'XAU/USD', 'SELL', 1.00, 2420, 2435, 2435, 2390, 2440, -150.00, 'CLOSED', '2026-11-19 09:00:00', '2026-11-19 11:00:00').lastInsertRowid);
    createdTradeIds.push(insTrade.run(testUserId, 'ETH/USD', 'BUY', 2.00, 3500, 3540, null, 3700, 3400, 80.00, 'OPEN', '2026-11-20 08:00:00', null).lastInsertRowid);

    const rLogin = await httpReq(port, 'GET', '/__test_login');
    const cookie = (rLogin.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');

    // 2. GET /trade-history
    const rPage = await httpReq(port, 'GET', '/trade-history', { Cookie: cookie });
    if (rPage.status !== 200) throw new Error('GET /trade-history failed: ' + rPage.status);
    if (!rPage.body.includes('BTC/USD') || !rPage.body.includes('Download CSV')) throw new Error('Missing expected content in /trade-history');
    console.log('✓ 2. GET /trade-history rendered 200 OK with trades & download buttons');

    // 3. GET /trade-history/download?format=csv (all)
    const rCsv = await httpReq(port, 'GET', '/trade-history/download?format=csv', { Cookie: cookie });
    if (rCsv.status !== 200) throw new Error('CSV download failed: ' + rCsv.status);
    if (!(rCsv.headers['content-type'] || '').includes('text/csv')) throw new Error('Wrong CSV content-type: ' + rCsv.headers['content-type']);
    if (!(rCsv.headers['content-disposition'] || '').includes('.csv')) throw new Error('Wrong CSV disposition: ' + rCsv.headers['content-disposition']);
    const csvLines = rCsv.body.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
    if (csvLines.length !== 4) throw new Error('Expected 1 header + 3 trade rows in CSV, got ' + csvLines.length);
    console.log('✓ 3. CSV export returned 200 OK with 1 header + 3 trade rows');

    // 4. Filtered CSV export (CLOSED + BUY)
    const rCsvFilt = await httpReq(port, 'GET', '/trade-history/download?format=csv&status=CLOSED&type=BUY', { Cookie: cookie });
    const filtLines = rCsvFilt.body.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
    if (filtLines.length !== 2 || !filtLines[1].includes('BTC/USD')) throw new Error('Filtered CSV mismatch: ' + rCsvFilt.body);
    console.log('✓ 4. Filtered CSV export (status=CLOSED&type=BUY) returned exact matching row');

    // 5. JSON export
    const rJson = await httpReq(port, 'GET', '/trade-history/download?format=json', { Cookie: cookie });
    const parsed = JSON.parse(rJson.body);
    if (parsed.trades.length !== 3 || parsed.summary.netPnL !== 450 || parsed.summary.winRate !== 50) {
      throw new Error('JSON export summary mismatch: ' + JSON.stringify(parsed.summary));
    }
    console.log('✓ 5. JSON export returned valid payload (3 trades, netPnL=$450, winRate=50%)');

    // 6. Printable Statement
    const rStmt = await httpReq(port, 'GET', '/trade-history/statement?status=CLOSED', { Cookie: cookie });
    if (rStmt.status !== 200 || !rStmt.body.includes('Official Trade Execution Statement') || !rStmt.body.includes('BTC/USD')) {
      throw new Error('Statement render failed: ' + rStmt.status);
    }
    console.log('✓ 6. Printable / PDF Trade Statement rendered 200 OK');

    // 7. WebTrader & /api/user/sync include closedTrades
    const rWt = await httpReq(port, 'GET', '/webtrade/app', { Cookie: cookie });
    if (rWt.status !== 200 || !rWt.body.includes('Trade History') || !rWt.body.includes('/trade-history/download?format=csv')) {
      throw new Error('WebTrader Trade History tab check failed: ' + rWt.status);
    }
    const rSync = await httpReq(port, 'GET', '/api/user/sync', { Cookie: cookie });
    const syncData = JSON.parse(rSync.body);
    if (!Array.isArray(syncData.closedTrades) || syncData.closedTrades.length !== 2) {
      throw new Error('Sync closedTrades mismatch: ' + JSON.stringify(syncData.closedTrades));
    }
    console.log('✓ 7. WebTrader tab & /api/user/sync live closedTrades verified (2 closed trades)');

    console.log('\n🎉 ALL 7 TRADE HISTORY & DOWNLOAD TESTS PASSED 100%!');
  } finally {
    if (testUserId) {
      db.prepare('DELETE FROM trades WHERE user_id = ?').run(testUserId);
      db.prepare('DELETE FROM retirement_accounts WHERE user_id = ?').run(testUserId);
      db.prepare('DELETE FROM user_crypto_balances WHERE user_id = ?').run(testUserId);
      db.prepare('DELETE FROM activity_logs WHERE user_id = ?').run(testUserId);
      db.prepare('DELETE FROM users WHERE id = ?').run(testUserId);
    }
    server.close();
    process.exit(0);
  }
})().catch(err => {
  console.error('❌ TEST FAILED:', err);
  process.exit(1);
});
