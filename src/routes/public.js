const express = require('express');
const router = express.Router();
const db = require('../db');
const { getLivePrices } = require('../services/livePriceService');
const { STOCK_BASKETS } = require('../services/stockBasketService');

// Home page
router.get('/', (req, res) => {
  const masters = db.prepare('SELECT * FROM master_traders WHERE is_active = 1 ORDER BY total_roi DESC LIMIT 4').all();
  res.render('public/home', { 
    title: 'MAINSTREET CAPITAL EXCHANGE | Trade the markets with clarity.', 
    masters,
    stockBaskets: STOCK_BASKETS,
    livePrices: getLivePrices()
  });
});

// Markets page
router.get('/markets', (req, res) => {
  const instruments = db.prepare('SELECT * FROM market_settings WHERE is_tradable = 1 ORDER BY id ASC').all();
  res.render('public/markets', { 
    title: 'Global Markets & Real-Time Asset Rates | MAINSTREET CAPITAL EXCHANGE', 
    instruments,
    livePrices: getLivePrices()
  });
});

// Copy Trading page & Comment Session Hub
router.get('/copy-trading', (req, res) => {
  const masters = db.prepare('SELECT * FROM master_traders WHERE is_active = 1 ORDER BY total_roi DESC').all();
  const comments = db.prepare(`
    SELECT c.*, mt.name as master_name, mt.strategy_name as master_strategy, mt.avatar as master_avatar
    FROM copy_trading_comments c
    LEFT JOIN master_traders mt ON c.master_id = mt.id
    WHERE c.is_approved = 1
    ORDER BY c.is_pinned DESC, c.id DESC
  `).all();

  const masterTrades = db.prepare(`
    SELECT * FROM master_trades
    ORDER BY COALESCE(closed_at, opened_at) DESC, id DESC
  `).all();

  res.render('public/copy-trading', {
    title: 'Verified Copy Trading & Strategy Marketplace | MAINSTREET CAPITAL EXCHANGE',
    masters,
    comments,
    masterTrades
  });
});

// Fetch Copy Trading Comments API
router.get('/api/copy-trading/comments', (req, res) => {
  try {
    const { master_id } = req.query;
    let query = `
      SELECT c.*, mt.name as master_name, mt.strategy_name as master_strategy, mt.avatar as master_avatar
      FROM copy_trading_comments c
      LEFT JOIN master_traders mt ON c.master_id = mt.id
      WHERE c.is_approved = 1
    `;
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
    const emojiPool = ['🛡️', '📊', '💎', '⚡', '🚀', '🏛️', '📈', '🤖', '🌏', '🥇'];
    let avatar = emojiPool[Math.floor(Math.random() * emojiPool.length)];
    let badge = 'Verified Copier';

    if (userId) {
      const user = db.prepare('SELECT id, name, avatar FROM users WHERE id = ?').get(userId);
      if (user) {
        name = user.name || name || 'Verified Investor';
        avatar = emojiPool[(Number(user.id) || 0) % emojiPool.length];
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

    const stmt = db.prepare(`
      INSERT INTO copy_trading_comments (master_id, user_id, author_name, author_avatar, rating, badge, comment, likes_count, is_pinned, is_approved)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 1)
    `);
    const info = stmt.run(cleanMasterId, userId, name, avatar, cleanRating, badge, comment.trim());

    const newComment = db.prepare(`
      SELECT c.*, mt.name as master_name, mt.strategy_name as master_strategy, mt.avatar as master_avatar
      FROM copy_trading_comments c
      LEFT JOIN master_traders mt ON c.master_id = mt.id
      WHERE c.id = ?
    `).get(info.lastInsertRowid);

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
});

// Investment Plans & Thematic Baskets
router.get(['/investment-plans', '/investments', '/invest'], (req, res) => {
  const plans = db.prepare('SELECT * FROM investment_plans ORDER BY min_deposit ASC').all();
  res.render('public/investment-plans', {
    title: 'Institutional Yield & Thematic Portfolios | MAINSTREET CAPITAL EXCHANGE',
    plans,
    stockBaskets: STOCK_BASKETS
  });
});

// Retirement page
router.get('/retirement', (req, res) => {
  res.render('public/retirement', {
    title: 'Institutional IRAs & Wealth Compounding | MAINSTREET CAPITAL EXCHANGE'
  });
});

// Analytics page
router.get('/analytics', (req, res) => {
  res.render('public/analytics', { 
    title: 'Portfolio Analytics & Risk Engine | MAINSTREET CAPITAL EXCHANGE',
    livePrices: getLivePrices()
  });
});

// WebTrader page
router.get('/webtrade', (req, res) => {
  res.render('public/webtrade', { 
    title: 'Trading Terminal & Order Book | MAINSTREET CAPITAL EXCHANGE' 
  });
});

// About page
router.get('/about', (req, res) => {
  res.render('public/about', { 
    title: 'About MAINSTREET CAPITAL EXCHANGE | Institutional Multi-Asset Execution' 
  });
});

// Careers page
router.get('/careers', (req, res) => {
  res.render('public/careers', { 
    title: 'Careers & Engineering | MAINSTREET CAPITAL EXCHANGE' 
  });
});

// Contact page
router.get('/contact', (req, res) => {
  res.render('public/contact', { 
    title: 'Institutional Support & Client Desk | MAINSTREET CAPITAL EXCHANGE' 
  });
});

// POST Contact Form
router.post('/contact', (req, res) => {
  const { name, email, subject, message } = req.body;
  if (!name || !email || !message) {
    req.session.flash = { error: 'Please complete all required fields.' };
    return res.redirect('/contact');
  }

  db.prepare(`
    INSERT INTO contact_messages (name, email, subject, message)
    VALUES (?, ?, ?, ?)
  `).run(name, email, subject || 'General Inquiry', message);

  req.session.flash = { success: 'Your message has been received. A Senior Account Executive will respond within 24 hours.' };
  res.redirect('/contact');
});

// Security & Custody page
router.get('/security', (req, res) => {
  res.render('public/security', { 
    title: 'Custody & Platform Security Architecture | MAINSTREET CAPITAL EXCHANGE' 
  });
});

// Legal & Compliance pages
router.get('/legal-docs', (req, res) => {
  res.render('public/legal-docs', { 
    title: 'Regulatory Disclosures & Legal Documents | MAINSTREET CAPITAL EXCHANGE' 
  });
});

router.get(['/terms', '/privacy', '/risk'], (req, res) => {
  res.render('public/legal-docs', { 
    title: 'Regulatory Disclosures & Legal Documents | MAINSTREET CAPITAL EXCHANGE' 
  });
});

// Learn / Academy Public Page
router.get('/learn', (req, res) => {
  res.render('public/legal-docs', { 
    title: 'Trading Academy & Knowledge Base | MAINSTREET CAPITAL EXCHANGE' 
  });
});

// WebTerminal & Trading Terminal Direct Aliases
router.get(['/webterminal', '/terminal', '/trade', '/trader', '/trading'], (req, res) => {
  if (req.session.userId) {
    return res.redirect('/webtrade/app');
  }
  const trader = db.prepare("SELECT id FROM users WHERE role = 'user' ORDER BY id ASC LIMIT 1").get();
  res.redirect('/login');
});

const { MODEL_PERSONAS, generateCopilotAnalysis } = require('../services/aiCopilotService');
const { detectGeoFromRequest, SUPPORTED_LANGUAGES, COUNTRY_TO_LANG } = require('../services/geoService');

// IP & Geolocation Language Detection API
router.get('/api/geo/detect', (req, res) => {
  const geo = detectGeoFromRequest(req);
  res.json({
    success: true,
    ...geo,
    supportedLanguages: SUPPORTED_LANGUAGES,
    countryMap: COUNTRY_TO_LANG
  });
});

// AI Financial Copilot API (Public & Interactive)
router.get('/api/copilot/models', (req, res) => {
  res.json({ success: true, models: MODEL_PERSONAS });
});

router.post('/api/copilot/query', (req, res) => {
  const { prompt, model, asset, timeframe } = req.body;
  const analysis = generateCopilotAnalysis({ prompt, model, asset, timeframe });
  res.json(analysis);
});

module.exports = router;

