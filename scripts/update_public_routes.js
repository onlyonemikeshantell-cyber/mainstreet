const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../src/routes/public.js');
let c = fs.readFileSync(filePath, 'utf8');

const target = `// Copy Trading page
router.get('/copy-trading', (req, res) => {
  const masters = db.prepare('SELECT * FROM master_traders WHERE is_active = 1 ORDER BY total_roi DESC').all();
  res.render('public/copy-trading', {
    title: 'Verified Copy Trading & Strategy Marketplace | MAINSTREET CAPITAL EXCHANGE',
    masters
  });
});`;

const replacement = `// Copy Trading page & Comment Session Hub
router.get('/copy-trading', (req, res) => {
  const masters = db.prepare('SELECT * FROM master_traders WHERE is_active = 1 ORDER BY total_roi DESC').all();
  const comments = db.prepare(\`
    SELECT c.*, mt.name as master_name, mt.strategy_name as master_strategy, mt.avatar as master_avatar
    FROM copy_trading_comments c
    LEFT JOIN master_traders mt ON c.master_id = mt.id
    WHERE c.is_approved = 1
    ORDER BY c.is_pinned DESC, c.id DESC
  \`).all();

  res.render('public/copy-trading', {
    title: 'Verified Copy Trading & Strategy Marketplace | MAINSTREET CAPITAL EXCHANGE',
    masters,
    comments
  });
});

// Fetch Copy Trading Comments API
router.get('/api/copy-trading/comments', (req, res) => {
  try {
    const { master_id } = req.query;
    let query = \`
      SELECT c.*, mt.name as master_name, mt.strategy_name as master_strategy, mt.avatar as master_avatar
      FROM copy_trading_comments c
      LEFT JOIN master_traders mt ON c.master_id = mt.id
      WHERE c.is_approved = 1
    \`;
    const params = [];
    if (master_id && master_id !== 'all') {
      query += ' AND c.master_id = ?';
      params.push(master_id);
    }
    query += ' ORDER BY c.is_pinned DESC, c.id DESC';
    const comments = db.prepare(query).all(...params);
    res.json({ success: true, comments });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Post Copy Trading Comment / Strategy Review
router.post('/api/copy-trading/comment', (req, res) => {
  try {
    const { master_id, rating, comment, author_name } = req.body;
    if (!comment || !comment.trim()) {
      if (req.xhr || req.headers.accept?.includes('json')) {
        return res.status(400).json({ success: false, error: 'Comment text is required.' });
      }
      req.session.flash = { error: 'Please enter a comment message.' };
      return res.redirect(req.get('referer') || '/copy-trading');
    }

    const userId = req.session ? req.session.userId : null;
    let name = author_name ? author_name.trim() : '';
    let avatar = 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&auto=format&fit=crop&q=80';
    let badge = 'Verified Copier';

    if (userId) {
      const user = db.prepare('SELECT id, name, avatar FROM users WHERE id = ?').get(userId);
      if (user) {
        name = user.name || name || 'Verified Investor';
        if (user.avatar) avatar = user.avatar;
        if (master_id) {
          const sub = db.prepare('SELECT id FROM copy_subscriptions WHERE user_id = ? AND master_id = ? AND status = "active"').get(userId, master_id);
          badge = sub ? 'Active Strategy Copier' : 'Verified Member';
        } else {
          badge = 'Verified Member';
        }
      }
    } else {
      if (!name) name = 'Community Trader';
      badge = 'Community Member';
    }

    const cleanRating = Math.max(1, Math.min(5, parseInt(rating) || 5));
    const cleanMasterId = master_id && master_id !== '' && master_id !== 'all' ? parseInt(master_id) : null;

    const stmt = db.prepare(\`
      INSERT INTO copy_trading_comments (master_id, user_id, author_name, author_avatar, rating, badge, comment, likes_count, is_pinned, is_approved)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 1)
    \`);
    const info = stmt.run(cleanMasterId, userId, name, avatar, cleanRating, badge, comment.trim());

    const newComment = db.prepare(\`
      SELECT c.*, mt.name as master_name, mt.strategy_name as master_strategy, mt.avatar as master_avatar
      FROM copy_trading_comments c
      LEFT JOIN master_traders mt ON c.master_id = mt.id
      WHERE c.id = ?
    \`).get(info.lastInsertRowid);

    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.json({ success: true, comment: newComment });
    }
    req.session.flash = { success: 'Your review and comment has been posted!' };
    res.redirect(req.get('referer') || '/copy-trading');
  } catch (err) {
    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.status(500).json({ success: false, error: err.message });
    }
    req.session.flash = { error: 'Failed to post comment: ' + err.message };
    res.redirect(req.get('referer') || '/copy-trading');
  }
});

// Like / Helpful Reaction for Copy Trading Comment
router.post('/api/copy-trading/comment/like', (req, res) => {
  try {
    const { comment_id } = req.body;
    if (!comment_id) {
      return res.status(400).json({ success: false, error: 'Comment ID is required' });
    }
    db.prepare('UPDATE copy_trading_comments SET likes_count = likes_count + 1 WHERE id = ?').run(comment_id);
    const updated = db.prepare('SELECT likes_count FROM copy_trading_comments WHERE id = ?').get(comment_id);
    res.json({ success: true, likes_count: updated ? updated.likes_count : 0 });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});`;

if (c.includes("router.get('/copy-trading'")) {
  c = c.replace(target, () => replacement);
  fs.writeFileSync(filePath, c, 'utf8');
  console.log('✓ Updated src/routes/public.js with copy trading comment routes');
} else {
  console.error('Target not found in src/routes/public.js');
}
