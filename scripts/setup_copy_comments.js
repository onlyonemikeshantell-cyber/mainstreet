const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, '../src/db.js');
let content = fs.readFileSync(dbPath, 'utf8');

const target = '// 13. Password Resets Table';
const addition = `// 14b. Copy Trading Comments & Community Reviews Table
db.exec(\`
  CREATE TABLE IF NOT EXISTS copy_trading_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    master_id INTEGER DEFAULT NULL,
    user_id INTEGER DEFAULT NULL,
    author_name TEXT NOT NULL,
    author_avatar TEXT DEFAULT 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&auto=format&fit=crop&q=80',
    rating INTEGER DEFAULT 5,
    badge TEXT DEFAULT 'Verified Copier',
    comment TEXT NOT NULL,
    likes_count INTEGER DEFAULT 0,
    is_pinned INTEGER DEFAULT 0,
    is_approved INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(master_id) REFERENCES master_traders(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
\`);

try {
  const commentCount = db.prepare('SELECT COUNT(*) as count FROM copy_trading_comments').get().count;
  if (commentCount === 0) {
    const sophia = db.prepare("SELECT id FROM master_traders WHERE name LIKE '%Sophia%' LIMIT 1").get();
    const vance = db.prepare("SELECT id FROM master_traders WHERE name LIKE '%Vance%' LIMIT 1").get();
    const quantum = db.prepare("SELECT id FROM master_traders WHERE name LIKE '%Quantum%' LIMIT 1").get();
    const elena = db.prepare("SELECT id FROM master_traders WHERE name LIKE '%Elena%' LIMIT 1").get();
    const marcus = db.prepare("SELECT id FROM master_traders WHERE name LIKE '%Marcus%' LIMIT 1").get();

    const insertComment = db.prepare(\`
      INSERT INTO copy_trading_comments (master_id, user_id, author_name, author_avatar, rating, badge, comment, likes_count, is_pinned, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))
    \`);

    insertComment.run(null, null, 'Julian Vance-Moreau', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&auto=format&fit=crop&q=80', 5, 'Portfolio Strategist', 'For anyone new to Mainstreet copy trading: diversify between at least two masters (one Crypto/HFT and one Forex/Gold). That combination gives maximum Sharpe ratio with near-zero correlation during market open spikes.', 28, 1, '-1 hours');

    insertComment.run(sophia ? sophia.id : null, null, 'David K. - Zurich, CH', 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&auto=format&fit=crop&q=80', 5, 'VIP Copier ($10k+)', 'Allocated $10,000 across Sophia Vanguard and Elena Rostova 4 months ago. The automated execution latency is genuinely sub-second. +34.2% net yield realized so far, and quarterly profit share deductions are handled seamlessly.', 24, 1, '-3 hours');

    insertComment.run(sophia ? sophia.id : null, null, 'Marcus Lindqvist', 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&auto=format&fit=crop&q=80', 5, 'Verified Copier', 'Sophia Vanguard\\'s intraday scalping on Bitcoin and US30 caught the entire FOMC volatility swing without drawdown. Highly recommend keeping at least $2,000 allocated for optimal position sizing.', 19, 0, '-6 hours');

    insertComment.run(vance ? vance.id : null, null, 'Sarah Chen - Singapore', 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=100&auto=format&fit=crop&q=80', 5, 'Verified Copier', 'Alexander Vance is unmatched for Gold (XAU/USD) breakouts. The tight trailing stops prevent big pullbacks during European session opens. Very consistent +1.2% to +2.5% daily compounding.', 15, 0, '-12 hours');

    insertComment.run(quantum ? quantum.id : null, null, "Liam O'Connor", 'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?w=100&auto=format&fit=crop&q=80', 5, 'Verified Copier', "Alpha Quantum Elite's liquidity model is exceptionally smooth. Zero emotional trading, pure statistical arbitrage across multi-asset pairs. Easily the best passive trading setup.", 11, 0, '-1 days');

    insertComment.run(elena ? elena.id : null, null, 'Dr. Raymond Scott', 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&auto=format&fit=crop&q=80', 5, 'Verified Copier', "Elena Rostova's Titan Matrix has been my primary forex earner. Steady win rate at 94%+, risk is well balanced, and order closure happens instantly.", 8, 0, '-2 days');

    insertComment.run(marcus ? marcus.id : null, null, 'Elena Belova', 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=100&auto=format&fit=crop&q=80', 5, 'Verified Copier', "Marcus Aurelius Quant's systematic alpha is rock solid. Low drawdowns, patient entry points, and impressive compounding. Excellent strategy for risk-averse portfolios.", 7, 0, '-3 days');
  }
} catch (e) {
  console.warn('Seeding note:', e.message);
}

// 13. Password Resets Table`;

if (!content.includes('copy_trading_comments')) {
  content = content.replace(target, () => addition);
  fs.writeFileSync(dbPath, content, 'utf8');
  console.log('✓ Added copy_trading_comments table to src/db.js');
} else {
  console.log('src/db.js already contains copy_trading_comments');
}
