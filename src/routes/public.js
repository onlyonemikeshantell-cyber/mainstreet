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

// Copy Trading page
router.get('/copy-trading', (req, res) => {
  const masters = db.prepare('SELECT * FROM master_traders WHERE is_active = 1 ORDER BY total_roi DESC').all();
  res.render('public/copy-trading', {
    title: 'Verified Copy Trading & Strategy Marketplace | MAINSTREET CAPITAL EXCHANGE',
    masters
  });
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

