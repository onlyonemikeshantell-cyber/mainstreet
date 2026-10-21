const path = require('path');
const db = require('../src/db');

const count = db.prepare('SELECT COUNT(*) as count FROM master_trades').get().count;
if (count === 0) {
  const masters = db.prepare('SELECT id FROM master_traders').all();
  if (masters.length > 0) {
    const stmt = db.prepare(`
      INSERT INTO master_trades (master_id, symbol, type, lot_size, open_price, current_price, profit_loss, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(masters[0].id, 'BTC/USD', 'BUY', 1.5, 62400.0, 64250.0, 2775.0, 'OPEN');
    stmt.run(masters[0].id, 'ETH/USD', 'BUY', 5.0, 3320.0, 3480.0, 800.0, 'OPEN');
    if (masters.length > 1) {
      stmt.run(masters[1].id, 'XAU/USD', 'BUY', 2.0, 2340.5, 2385.0, 890.0, 'OPEN');
      stmt.run(masters[1].id, 'EUR/USD', 'SELL', 3.0, 1.0920, 1.0850, 210.0, 'CLOSED');
    }
    console.log('Seeded sample master strategy trades.');
  }
}
