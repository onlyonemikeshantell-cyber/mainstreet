const db = require('../src/db');

console.log('=== Step 1: Testing copy_trading_comments queries ===');
const allComments = db.prepare(`
  SELECT c.*, mt.name as master_name, mt.strategy_name as master_strategy
  FROM copy_trading_comments c
  LEFT JOIN master_traders mt ON c.master_id = mt.id
  WHERE c.is_approved = 1
  ORDER BY c.is_pinned DESC, c.id DESC
`).all();
console.log('✓ Found', allComments.length, 'total comments.');

console.log('=== Step 2: Testing Comment Insertion ===');
const testInsert = db.prepare(`
  INSERT INTO copy_trading_comments (master_id, user_id, author_name, author_avatar, rating, badge, comment, likes_count, is_pinned, is_approved)
  VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 1)
`).run(5, 11, 'Valerie Page', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80', 5, 'Active Strategy Copier', 'Testing real-time comment and review posting for Sophia Vanguard strategy.');

console.log('✓ Inserted test comment ID:', testInsert.lastInsertRowid);

console.log('=== Step 3: Testing Likes increment ===');
db.prepare('UPDATE copy_trading_comments SET likes_count = likes_count + 1 WHERE id = ?').run(testInsert.lastInsertRowid);
const checkLike = db.prepare('SELECT likes_count FROM copy_trading_comments WHERE id = ?').get(testInsert.lastInsertRowid);
console.log('✓ Likes count after like:', checkLike.likes_count);

// Clean up test comment
db.prepare('DELETE FROM copy_trading_comments WHERE id = ?').run(testInsert.lastInsertRowid);
console.log('✓ Cleaned up test comment.');
console.log('=== ALL COPY TRADING COMMENT TESTS PASSED ===');
