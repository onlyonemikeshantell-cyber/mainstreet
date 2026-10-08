require('dotenv').config();

process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]:', reason);
});

const express = require('express');
const session = require('express-session');
const path = require('path');
const cors = require('cors');

// Import DB & Middleware
const db = require('./src/db');
const { injectUser } = require('./src/middleware/auth');
const csrfMiddleware = require('./src/middleware/csrf');

// Import Routes
const publicRoutes = require('./src/routes/public');
const authRoutes = require('./src/routes/auth');
const userRoutes = require('./src/routes/user');
const adminRoutes = require('./src/routes/admin');
const retirementRoutes = require('./src/routes/retirement');

const app = express();
const PORT = process.env.PORT || 3333;

app.disable('x-powered-by');

// HTTP Security Headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  next();
});

app.set('trust proxy', 1);

// View engine setup
app.set('views', path.join(__dirname, 'src', 'views'));
app.set('view engine', 'ejs');

// Static assets
app.use(express.static(path.join(__dirname, 'public')));

// Body parsing
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.json({ limit: '50mb' }));
app.use(cors());

// Session setup
app.use(session({
  secret: process.env.SESSION_SECRET || 'mainstreet_secure_jwt_token_session_2026',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7, // 1 week
    httpOnly: true,
    sameSite: 'lax'
  }
}));

// CSRF & User injection
app.use(csrfMiddleware);
app.use(injectUser);

// Mount application routes
app.use('/', publicRoutes);
app.use('/', authRoutes);
app.use('/', adminRoutes);
app.use('/', retirementRoutes);
app.use('/', userRoutes);

// 404 Handler
app.use((req, res) => {
  res.status(404).render('public/home', { 
    title: 'Mainstreet Capital Exchange | Page Not Found',
    flash: { error: 'The requested page could not be located. Redirected to home.' }
  });
});

// Error Handler
app.use((err, req, res, next) => {
  console.error('Server Unhandled Error:', err);
  res.status(500).send('Internal Server Error');
});

// ==============================================================================
// BACKGROUND WORKER: Automated Copy Trading Micro-Profit Accrual
// ==============================================================================
setInterval(() => {
  try {
    const activeSubs = db.prepare("SELECT * FROM copy_subscriptions WHERE status = 'active'").all();
    if (activeSubs && activeSubs.length > 0) {
      const updateStmt = db.prepare('UPDATE copy_subscriptions SET current_profit = current_profit + ? WHERE id = ?');
      activeSubs.forEach(sub => {
        // Accrue a realistic random micro-return (+0.02% to +0.08% of allocated capital)
        const microRate = (Math.random() * 0.0006 + 0.0002);
        const profitGain = +(sub.allocated_amount * microRate).toFixed(2);
        updateStmt.run(profitGain, sub.id);
      });
    }
  } catch (err) {
    console.error('Copy Trading Accrual Worker Error:', err.message);
  }
}, 45000); // Runs every 45 seconds

// Start Server
// ==============================================================================
// BACKGROUND WORKER: Automated Take Profit & Stop Loss (TP/SL) Liquidation
// ==============================================================================
const { getLivePrices } = require('./src/services/livePriceService');

setInterval(() => {
  try {
    const openTrades = db.prepare("SELECT * FROM trades WHERE status = 'OPEN'").all();
    if (!openTrades || openTrades.length === 0) return;

    const prices = getLivePrices();
    
    openTrades.forEach(trade => {
      let currentPrice = trade.current_price;
      if (trade.symbol.includes('BTC') && prices['BTC']) currentPrice = prices['BTC'].price;
      else if (trade.symbol.includes('ETH') && prices['ETH']) currentPrice = prices['ETH'].price;
      else if (trade.symbol.includes('SOL') && prices['SOL']) currentPrice = prices['SOL'].price;
      else if (trade.symbol.includes('BNB') && prices['BNB']) currentPrice = prices['BNB'].price;

      // Update current price
      db.prepare('UPDATE trades SET current_price = ? WHERE id = ?').run(currentPrice, trade.id);

      let shouldClose = false;
      let closeReason = '';

      if (trade.type === 'BUY') {
        if (trade.take_profit && currentPrice >= trade.take_profit) {
          shouldClose = true;
          closeReason = 'TAKE_PROFIT_TRIGGER';
        } else if (trade.stop_loss && currentPrice <= trade.stop_loss) {
          shouldClose = true;
          closeReason = 'STOP_LOSS_TRIGGER';
        }
      } else if (trade.type === 'SELL') {
        if (trade.take_profit && currentPrice <= trade.take_profit) {
          shouldClose = true;
          closeReason = 'TAKE_PROFIT_TRIGGER';
        } else if (trade.stop_loss && currentPrice >= trade.stop_loss) {
          shouldClose = true;
          closeReason = 'STOP_LOSS_TRIGGER';
        }
      }

      if (shouldClose) {
        const diff = trade.type === 'BUY' ? (currentPrice - trade.open_price) : (trade.open_price - currentPrice);
        const multiplier = trade.symbol.includes('EUR') || trade.symbol.includes('GBP') ? 100000 : 1;
        const finalPnL = +(diff * trade.lot_size * multiplier).toFixed(2);

        // Settle Trade
        db.prepare(`
          UPDATE trades 
          SET status = 'CLOSED', close_price = ?, profit_loss = ?, closed_at = CURRENT_TIMESTAMP 
          WHERE id = ?
        `).run(currentPrice, finalPnL, trade.id);

        // Update User Balance
        const u = db.prepare('SELECT balance, equity FROM users WHERE id = ?').get(trade.user_id);
        if (u) {
          const newBal = u.balance + finalPnL;
          db.prepare('UPDATE users SET balance = ?, equity = ? WHERE id = ?').run(newBal, newBal, trade.user_id);
        }

        console.log(`[TP/SL Engine] Auto-closed Trade #${trade.id} (${trade.symbol} ${trade.type}) @ $${currentPrice} [${closeReason}] -> P&L: $${finalPnL}`);
      }
    });
  } catch (err) {
    console.error('TP/SL Worker Error:', err.message);
  }
}, 2500);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Mainstreet Capital Exchange platform is live at http://localhost:${PORT}`);
});
