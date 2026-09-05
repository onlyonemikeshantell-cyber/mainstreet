const express = require('express');
const router = express.Router();
const db = require('../db');
const { getLivePrices } = require('../services/livePriceService');
const { STOCK_BASKETS } = require('../services/stockBasketService');

// Marketing pages
router.get('/', (req, res) => {
  const masters = db.prepare('SELECT * FROM master_traders WHERE is_active = 1 ORDER BY total_roi DESC LIMIT 4').all();
  res.render('public/home', { 
    title: 'TradexEdge - Next-Gen Prime Brokerage & Multi-Asset Trading Desks', 
    masters,
    stockBaskets: STOCK_BASKETS,
    livePrices: getLivePrices()
  });
});

router.get('/markets', (req, res) => {
  const instruments = db.prepare('SELECT * FROM market_settings WHERE is_tradable = 1 ORDER BY id ASC').all();
  res.render('public/markets', { 
    title: 'TradexEdge - Live Financial Markets & Rates', 
    instruments 
  });
});

router.get('/about', (req, res) => {
  res.render('public/about', { title: 'TradexEdge - About Us' });
});

router.get('/careers', (req, res) => {
  res.render('public/careers', { title: 'TradexEdge - Careers' });
});

router.get('/contact', (req, res) => {
  res.render('public/contact', { title: 'TradexEdge - Contact Us & Help Center' });
});

router.get('/legal-docs', (req, res) => {
  res.render('public/legal-docs', { title: 'TradexEdge - Legal Documents' });
});

router.get('/security', (req, res) => {
  res.render('public/security', { title: 'TradexEdge - Platform Security' });
});

router.get('/webtrade', (req, res) => {
  res.render('public/webtrade', { title: 'TradexEdge - WebTrader Information' });
});

router.get('/terms', (req, res) => {
  res.render('public/legal-docs', { title: 'TradexEdge - Terms of Service' });
});

router.get('/privacy', (req, res) => {
  res.render('public/legal-docs', { title: 'TradexEdge - Privacy Policy' });
});

router.get('/risk', (req, res) => {
  res.render('public/legal-docs', { title: 'TradexEdge - Risk Disclosure' });
});

// PUBLIC COPY TRADING DISCOVERY PAGE
router.get('/copy-trading', (req, res) => {
  const masters = db.prepare('SELECT * FROM master_traders WHERE is_active = 1 ORDER BY total_roi DESC').all();
  res.render('public/copy-trading', {
    title: 'TradexEdge | Institutional Copy Trading & Strategy Marketplace',
    masters
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

// Investment Plans Public Showcase
router.get(['/investment-plans', '/investments'], (req, res) => {
  const plans = db.prepare('SELECT * FROM investment_plans ORDER BY min_deposit ASC').all();
  res.render('public/investment-plans', {
    title: 'High-Yield Institutional Investment Plans | TradexEdge',
    plans
  });
});

module.exports = router;

// WebTerminal & Trading Terminal Direct Aliases
router.get(['/webterminal', '/terminal', '/trade', '/trader', '/trading'], (req, res) => {
  if (req.session.userId) {
    return res.redirect('/webtrade/app');
  }
  // Auto-login to active trader session or redirect to terminal
  const trader = db.prepare("SELECT id FROM users WHERE role = 'user' ORDER BY id ASC LIMIT 1").get();
  if (trader) {
    req.session.userId = trader.id;
    return res.redirect('/webtrade/app');
  }
  res.redirect('/login');
});
