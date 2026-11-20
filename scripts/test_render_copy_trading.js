const ejs = require('ejs');
const fs = require('fs');
const path = require('path');
const db = require('../src/db');

const masters = db.prepare('SELECT * FROM master_traders WHERE is_active = 1 ORDER BY total_roi DESC').all();
const comments = db.prepare(`
  SELECT c.*, mt.name as master_name, mt.strategy_name as master_strategy, mt.avatar as master_avatar
  FROM copy_trading_comments c
  LEFT JOIN master_traders mt ON c.master_id = mt.id
  WHERE c.is_approved = 1
  ORDER BY c.is_pinned DESC, c.id DESC
`).all();

const dummyUser = { id: 11, name: 'Valerie Page', balance: 5000, avatar: null };

// 1. Test render public/copy-trading.ejs
try {
  const pubHtml = ejs.render(
    fs.readFileSync(path.join(__dirname, '../src/views/public/copy-trading.ejs'), 'utf8'),
    { user: null, site_settings: {}, csrfToken: 'test-token', safeJson: JSON.stringify, visitorGeo: {}, currentPath: '/copy-trading', masters, comments },
    { filename: path.resolve('src/views/public/copy-trading.ejs') }
  );
  console.log('✓ public/copy-trading.ejs rendered successfully, length:', pubHtml.length);
} catch (e) {
  console.error('Error rendering public/copy-trading.ejs:', e);
  process.exit(1);
}

// 2. Test render app/copy-trading-app.ejs
try {
  const appHtml = ejs.render(
    fs.readFileSync(path.join(__dirname, '../src/views/app/copy-trading-app.ejs'), 'utf8'),
    { user: dummyUser, site_settings: {}, csrfToken: 'test-token', safeJson: JSON.stringify, visitorGeo: {}, currentPath: '/copy-trading/app', masters, mySubscriptions: [], comments },
    { filename: path.resolve('src/views/app/copy-trading-app.ejs') }
  );
  console.log('✓ app/copy-trading-app.ejs rendered successfully, length:', appHtml.length);
} catch (e) {
  console.error('Error rendering app/copy-trading-app.ejs:', e);
  process.exit(1);
}

console.log('=== All copy-trading views compiled and rendered flawlessly! ===');
