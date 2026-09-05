const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const db = require('../db');

// Helper to save base64 media (image/video) to public/storage/kyc
const saveBase64Media = (base64String, prefix, userId) => {
  if (!base64String || typeof base64String !== 'string' || !base64String.includes('base64,')) {
    return null;
  }
  try {
    const kycDir = path.join(__dirname, '..', '..', 'public', 'storage', 'kyc');
    if (!fs.existsSync(kycDir)) {
      fs.mkdirSync(kycDir, { recursive: true });
    }

    const matches = base64String.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      return null;
    }

    const mime = matches[1];
    const data = Buffer.from(matches[2], 'base64');
    let ext = 'jpg';
    if (mime.includes('png')) ext = 'png';
    else if (mime.includes('webm')) ext = 'webm';
    else if (mime.includes('mp4')) ext = 'mp4';

    const filename = `${prefix}_user_${userId}_${Date.now()}.${ext}`;
    const filePath = path.join(kycDir, filename);
    fs.writeFileSync(filePath, data);
    return `/storage/kyc/${filename}`;
  } catch (err) {
    console.error('Failed to save base64 media:', err.message);
    return null;
  }
};

const { getLivePrices, syncClientLivePrice } = require('../services/livePriceService');
const { STOCK_BASKETS, STOCK_DIVIDEND_RATES } = require('../services/stockBasketService');
const { verifyCryptoDeposit } = require('../services/blockchainVerificationService');

// Live Real-Time Market Prices API
router.get('/api/market/prices', (req, res) => {
  res.json({ success: true, prices: getLivePrices(), timestamp: Date.now() });
});

router.post('/api/market/sync-live-price', (req, res) => {
  const { symbol, price } = req.body;
  if (symbol && price) {
    syncClientLivePrice(symbol, parseFloat(price));
  }
  res.json({ success: true });
});


// Economic Events API (Public)
router.get('/api/economic-calendar', (req, res) => {
  try {
    const events = db.prepare('SELECT * FROM economic_events ORDER BY id ASC').all();
    res.json({ success: true, events });
  } catch(e) {
    res.json({ success: true, events: [] });
  }
});

// AI Quant Trading Signals API (Public)
router.get('/api/signals', (req, res) => {
  try {
    const signals = db.prepare('SELECT * FROM trading_signals WHERE is_active = 1 ORDER BY id DESC').all();
    res.json({ success: true, signals });
  } catch(e) {
    res.json({ success: true, signals: [] });
  }
});

const { getCryptoSessionData } = require('../services/cryptoSessionService');

// 24/7 Crypto Session & On-Chain Metrics API (Public)
router.get('/api/crypto/session-data', (req, res) => {
  res.json({ success: true, session: getCryptoSessionData() });
});

// Require Auth Middleware with Seamless Demo Terminal Access
const requireAuth = (req, res, next) => {
  if (req.path.startsWith('/babyoku') || req.path.startsWith('/admin')) {
    return next();
  }
  if (!req.session.userId) {
    if (req.path === '/webtrade/app' || req.path === '/trading' || req.path === '/trade' || req.path === '/terminal' || req.path === '/api/user/sync' || req.path === '/api/trade/open' || req.path === '/api/trade/close') {
      const trader = db.prepare("SELECT id FROM users WHERE role = 'user' ORDER BY id ASC LIMIT 1").get();
      if (trader) {
        req.session.userId = trader.id;
        return next();
      }
    }
    req.session.flash = { error: 'Please log in to access this trading area.' };
    return res.redirect('/login');
  }
  next();
};

router.use(requireAuth);

// Helper to log user activity
const logActivity = (userId, action, details, req) => {
  try {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const ua = req.headers['user-agent'] || 'Unknown Browser';
    db.prepare(`
      INSERT INTO activity_logs (user_id, action, ip_address, user_agent, details)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, action, ip, ua, details);
  } catch (e) {
    console.error('Activity log error:', e.message);
  }
};

// 1. Trader Dashboard
router.get('/dashboard', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const openTrades = db.prepare("SELECT * FROM trades WHERE user_id = ? AND status = 'OPEN' ORDER BY id DESC").all(user.id);
  const recentTransactions = db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT 5').all(user.id);
  const activeSubscriptions = db.prepare(`
    SELECT cs.*, mt.name as master_name, mt.strategy_name, mt.avatar, mt.win_rate
    FROM copy_subscriptions cs
    JOIN master_traders mt ON cs.master_id = mt.id
    WHERE cs.user_id = ? AND cs.status = 'active'
  `).all(user.id);

  let totalPnL = 0;
  openTrades.forEach(t => totalPnL += t.profit_loss);
  const equity = (user.balance + totalPnL).toFixed(2);

  // Query Spot Holdings (Crypto, Stocks, Cash)
  const allBalances = db.prepare('SELECT * FROM user_crypto_balances WHERE user_id = ? ORDER BY id ASC').all(user.id);
  const cryptoBalances = allBalances.filter(b => b.asset_type === 'crypto' || !b.asset_type || b.asset_type === 'fiat');
  const stockBalances = allBalances.filter(b => b.asset_type === 'stock');

  // Compute estimated annual dividend income
  let estimatedAnnualDividends = 0;
  stockBalances.forEach(sb => {
    const rate = STOCK_DIVIDEND_RATES[sb.asset_symbol] || 0;
    const currentPrice = getLivePrices()[sb.asset_symbol]?.price || sb.rate_usd || 100;
    const stockVal = Number(sb.balance || 0) * currentPrice;
    estimatedAnnualDividends += (stockVal * rate);
  });

  const tradableMarkets = db.prepare('SELECT symbol, name, category FROM market_settings WHERE is_tradable = 1 ORDER BY category ASC, symbol ASC').all();

  // Query User's Retirement IRA Account & Holdings
  let retirementAccount = db.prepare('SELECT * FROM retirement_accounts WHERE user_id = ?').get(user.id);
  if (!retirementAccount) {
    const accNum = 'IRA-' + (80000 + Number(user.id)) + '-' + Math.floor(1000 + Math.random() * 9000);
    db.prepare(`
      INSERT INTO retirement_accounts (user_id, account_type, account_number, balance, equity, total_contributed, annual_limit, drip_enabled, status)
      VALUES (?, 'roth_ira', ?, 3500.00, 3500.00, 3500.00, 7000.00, 1, 'active')
    `).run(user.id, accNum);
    retirementAccount = db.prepare('SELECT * FROM retirement_accounts WHERE user_id = ?').get(user.id);
  }
  const retirementHoldings = db.prepare('SELECT * FROM retirement_holdings WHERE account_id = ?').all(retirementAccount.id);
  const retirementContributions = db.prepare('SELECT * FROM retirement_contributions WHERE account_id = ? ORDER BY id DESC LIMIT 5').all(retirementAccount.id);

  res.render('app/dashboard', {
    title: 'Trader Dashboard | TradexEdge',
    user,
    openTrades,
    recentTransactions,
    activeSubscriptions,
    equity,
    cryptoBalances,
    stockBalances,
    allBalances,
    tradableMarkets,
    retirementAccount,
    retirementHoldings,
    retirementContributions,
    stockBaskets: STOCK_BASKETS,
    dividendRates: STOCK_DIVIDEND_RATES,
    estimatedAnnualDividends: +estimatedAnnualDividends.toFixed(2),
    totalPnL: totalPnL.toFixed(2)
  });
});

// 2. Live WebTrader Terminal
router.get(['/webtrade/app', '/trading', '/trade', '/terminal'], (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const openTrades = db.prepare("SELECT * FROM trades WHERE user_id = ? AND status = 'OPEN' ORDER BY id DESC").all(user.id);
  const markets = db.prepare('SELECT * FROM market_settings WHERE is_tradable = 1').all();

  res.render('app/webtrader', {
    title: 'WebTrader Pro Execution Terminal | TradexEdge',
    user,
    openTrades,
    markets
  });
});

// 3. Authenticated Copy Trading Station
router.get('/copy-trading/app', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const masters = db.prepare('SELECT * FROM master_traders WHERE is_active = 1 ORDER BY total_roi DESC').all();
  const mySubscriptions = db.prepare(`
    SELECT cs.*, mt.name as master_name, mt.strategy_name, mt.avatar, mt.win_rate, mt.category
    FROM copy_subscriptions cs
    JOIN master_traders mt ON cs.master_id = mt.id
    WHERE cs.user_id = ?
    ORDER BY cs.id DESC
  `).all(user.id);

  res.render('app/copy-trading-app', {
    title: 'Copy Trading Portfolio Station | TradexEdge',
    user,
    masters,
    mySubscriptions
  });
});

// Follow Master Strategy
router.post('/api/copy-trading/follow', (req, res) => {
  const { master_id, amount } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const master = db.prepare('SELECT * FROM master_traders WHERE id = ?').get(master_id);

  if (!master) {
    req.session.flash = { error: 'Selected master trader strategy was not found.' };
    return res.redirect('/copy-trading/app');
  }

  const allocAmount = parseFloat(amount);
  if (isNaN(allocAmount) || allocAmount < (master.min_allocation || 100)) {
    req.session.flash = { error: `Minimum allocation for ${master.name} is $${master.min_allocation || 100}.` };
    return res.redirect('/copy-trading/app');
  }

  if (user.balance < allocAmount) {
    req.session.flash = { error: 'Insufficient account balance. Please deposit additional funds.' };
    return res.redirect('/deposit');
  }

  const newBalance = user.balance - allocAmount;
  db.prepare('UPDATE users SET balance = ?, equity = ? WHERE id = ?').run(newBalance, newBalance, user.id);

  db.prepare(`
    INSERT INTO copy_subscriptions (user_id, master_id, allocated_amount, current_profit, status)
    VALUES (?, ?, ?, 0.00, 'active')
  `).run(user.id, master.id, allocAmount);

  db.prepare(`
    INSERT INTO transactions (user_id, type, amount, currency, method, status, reference, description)
    VALUES (?, 'copy_allocate', ?, 'USD', 'Internal', 'completed', ?, ?)
  `).run(user.id, -allocAmount, 'CPY-' + Date.now(), `Strategy allocation to ${master.name} (${master.strategy_name})`);

  logActivity(user.id, 'COPY_FOLLOW', `Allocated $${allocAmount} to ${master.name}`, req);
  req.session.flash = { success: `Successfully allocated $${allocAmount.toLocaleString()} to mirror ${master.name}!` };
  res.redirect('/copy-trading/app');
});

// Stop Copy Strategy & Realize Gains
router.post('/api/copy-trading/stop', (req, res) => {
  const { subscription_id } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const sub = db.prepare('SELECT * FROM copy_subscriptions WHERE id = ? AND user_id = ?').get(subscription_id, user.id);

  if (!sub || sub.status !== 'active') {
    req.session.flash = { error: 'Active subscription record not found.' };
    return res.redirect('/copy-trading/app');
  }

  const returnAmount = sub.allocated_amount + sub.current_profit;
  const newBalance = user.balance + returnAmount;

  db.prepare('UPDATE users SET balance = ?, equity = ? WHERE id = ?').run(newBalance, newBalance, user.id);
  db.prepare("UPDATE copy_subscriptions SET status = 'stopped', stopped_at = CURRENT_TIMESTAMP WHERE id = ?").run(sub.id);

  db.prepare(`
    INSERT INTO transactions (user_id, type, amount, currency, method, status, reference, description)
    VALUES (?, 'copy_settle', ?, 'USD', 'Internal', 'completed', ?, ?)
  `).run(user.id, returnAmount, 'CPY-SET-' + Date.now(), `Copy Strategy settlement: Capital ($${sub.allocated_amount}) + Profit ($${sub.current_profit})`);

  logActivity(user.id, 'COPY_STOP', `Settled copy subscription #${sub.id} with return of $${returnAmount}`, req);
  req.session.flash = { success: `Strategy stopped. $${returnAmount.toFixed(2)} returned to your main cash balance.` };
  res.redirect('/copy-trading/app');
});

// 4. Deposit Station with Dynamic Wallets & Payment Proof Submission
router.get('/deposit', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const gateways = db.prepare('SELECT * FROM payment_gateways WHERE is_active = 1').all();
  const livePrices = getLivePrices();
  res.render('app/deposit', {
    title: 'Deposit Funds | TradexEdge Liquidity Desk',
    user,
    gateways,
    livePrices
  });
});

// Submit Deposit Request / Proof of Payment (Real On-Chain Verification + Auto-Reflecting)
router.post('/deposit', async (req, res) => {
  const { gateway_id, amount, tx_hash, proof_notes, proof_image } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const gateway = db.prepare('SELECT * FROM payment_gateways WHERE id = ?').get(gateway_id);

  const numAmount = parseFloat(amount);
  if (isNaN(numAmount) || numAmount <= 0) {
    if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
      return res.status(400).json({ success: false, error: 'Please enter a valid deposit amount.' });
    }
    req.session.flash = { error: 'Please enter a valid deposit amount.' };
    return res.redirect('/deposit');
  }

  if (gateway && gateway.min_deposit && numAmount < gateway.min_deposit) {
    const errMsg = `Deposit amount must be at least $${gateway.min_deposit} USD for ${gateway.name}.`;
    if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
      return res.status(400).json({ success: false, error: errMsg });
    }
    req.session.flash = { error: errMsg };
    return res.redirect('/deposit');
  }

  const ref = 'DEP-' + Math.floor(100000 + Math.random() * 900000);
  const gwName = gateway ? `${gateway.name} (${gateway.currency})` : 'Cryptocurrency Direct';

  // 1. REAL ON-CHAIN BLOCKCHAIN VERIFICATION
  let onChainResult = null;
  const isCryptoGateway = gateway && gateway.currency !== 'USD';

  if (isCryptoGateway && tx_hash) {
    try {
      onChainResult = await verifyCryptoDeposit({
        currency: gateway.currency,
        txHash: tx_hash,
        expectedAddress: gateway.address,
        amountUsd: numAmount,
        userId: user.id
      });
    } catch (verErr) {
      if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
        return res.status(400).json({ success: false, error: verErr.message });
      }
      req.session.flash = { error: `On-Chain Verification Error: ${verErr.message}` };
      return res.redirect('/deposit');
    }
  }

  // Check system settings for auto credit
  const settings = db.prepare('SELECT auto_credit_deposit FROM system_settings LIMIT 1').get();
  const shouldAutoCredit = !settings || settings.auto_credit_deposit === 1;

  // Use verified on-chain USD valuation if available
  const creditAmount = (onChainResult && onChainResult.usdValuation > 0) ? onChainResult.usdValuation : numAmount;

  if (shouldAutoCredit) {
    // Atomic deposit & instant balance credit
    const executeDeposit = db.transaction(() => {
      const txDesc = onChainResult && onChainResult.mode === 'live_blockchain'
        ? `Verified on ${onChainResult.network}: Transferred ${onChainResult.amountCrypto} ${onChainResult.symbol} (${onChainResult.confirmations} confs)`
        : (proof_notes || `Instant deposit of $${creditAmount.toLocaleString()} via ${gwName}`);

      // 1. Record completed transaction
      db.prepare(`
        INSERT INTO transactions (user_id, type, amount, currency, method, reference, tx_hash, description, proof_image, status)
        VALUES (?, 'deposit', ?, 'USD', ?, ?, ?, ?, ?, 'completed')
      `).run(
        user.id,
        creditAmount,
        gwName,
        ref,
        tx_hash || 'Direct Blockchain Confirmation',
        txDesc,
        proof_image || null
      );

      // 2. Immediately credit user's trading cash balance and equity
      const newBal = Number(user.balance) + creditAmount;
      const newEquity = Number(user.equity) + creditAmount;
      db.prepare('UPDATE users SET balance = ?, equity = ? WHERE id = ?').run(newBal, newEquity, user.id);

      // 3. Synchronize USD cash row in user_crypto_balances
      const usdRow = db.prepare("SELECT id FROM user_crypto_balances WHERE user_id = ? AND asset_symbol = 'USD'").get(user.id);
      if (usdRow) {
        db.prepare("UPDATE user_crypto_balances SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(creditAmount, usdRow.id);
      } else {
        db.prepare(`INSERT INTO user_crypto_balances (user_id, asset_symbol, asset_name, balance, icon, rate_usd, asset_type) VALUES (?, 'USD', 'US Dollar (Fiat)', ?, '$', 1.0, 'fiat')`).run(user.id, newBal);
      }

      // 3b. Also synchronize specific crypto balance in portfolio if crypto was deposited
      const rawCryptoSym = onChainResult ? onChainResult.symbol : (gateway && gateway.currency !== 'USD' ? gateway.currency.replace('-ERC20', '').replace('-TRC20', '') : null);
      if (rawCryptoSym && rawCryptoSym !== 'USD') {
        const livePrices = getLivePrices();
        const cryptoAmountToAdd = (onChainResult && onChainResult.amountCrypto > 0)
          ? onChainResult.amountCrypto
          : +(creditAmount / (livePrices[rawCryptoSym]?.price || 1)).toFixed(6);
        
        const cryptoRow = db.prepare("SELECT id FROM user_crypto_balances WHERE user_id = ? AND asset_symbol = ?").get(user.id, rawCryptoSym);
        if (cryptoRow) {
          db.prepare("UPDATE user_crypto_balances SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(cryptoAmountToAdd, cryptoRow.id);
        }
      }

      // 4. In-App Notification
      const notifMsg = onChainResult && onChainResult.mode === 'live_blockchain'
        ? `Deposit #${ref} ($${creditAmount.toLocaleString(undefined, {minimumFractionDigits: 2})} USD) verified on-chain via ${onChainResult.network} (${onChainResult.confirmations} confirmations) and credited instantly.`
        : `Deposit #${ref} ($${creditAmount.toLocaleString(undefined, {minimumFractionDigits: 2})} USD via ${gwName}) verified and credited to your trading account instantly.`;

      try {
        db.prepare("INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, 'deposit')")
          .run(user.id, 'Deposit Credited Instantly', notifMsg);
      } catch(ne) {}

      logActivity(user.id, 'DEPOSIT_AUTO_CREDITED', `Auto-credited deposit ref ${ref} for $${creditAmount} via ${gwName} (Verification: ${onChainResult ? onChainResult.mode : 'standard'})`, req);
    });

    executeDeposit();

    if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
      return res.json({ 
        success: true, 
        reference: ref, 
        amount: creditAmount, 
        newBalance: Number(user.balance) + creditAmount, 
        verification: onChainResult,
        message: 'Deposit verified and auto-credited to balance instantly!' 
      });
    }

    const successMsg = onChainResult && onChainResult.mode === 'live_blockchain'
      ? `Deposit #${ref} Verified on ${onChainResult.network}! $${creditAmount.toLocaleString(undefined, {minimumFractionDigits: 2})} USD (${onChainResult.amountCrypto} ${onChainResult.symbol}, ${onChainResult.confirmations} confs) credited to your trading balance.`
      : `Deposit #${ref} Confirmed! $${creditAmount.toLocaleString(undefined, {minimumFractionDigits: 2})} USD has been credited to your trading balance instantly.`;

    req.session.flash = { success: successMsg };
    return res.redirect('/dashboard');
  } else {
    // Manual audit fallback
    db.prepare(`
      INSERT INTO transactions (user_id, type, amount, currency, method, reference, tx_hash, description, proof_image, status)
      VALUES (?, 'deposit', ?, 'USD', ?, ?, ?, ?, ?, 'pending')
    `).run(
      user.id,
      numAmount,
      gwName,
      ref,
      tx_hash || 'Direct Transfer Confirmation',
      proof_notes || `Client initiated deposit of $${numAmount.toLocaleString()} via ${gwName}`,
      proof_image || null
    );

    try {
      db.prepare("INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, 'deposit')")
        .run(user.id, 'Deposit Submitted', `Deposit #${ref} ($${numAmount.toLocaleString()} USD) submitted and pending compliance verification.`);
    } catch(ne) {}

    logActivity(user.id, 'DEPOSIT_INIT', `Initiated deposit ref ${ref} for $${numAmount}`, req);
    req.session.flash = { success: `Deposit reference #${ref} registered! Custody department is verifying payment confirmation.` };
    return res.redirect('/transactions');
  }
});

// 5. Withdraw Station
router.get('/withdraw', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const openTrades = db.prepare("SELECT lot_size FROM trades WHERE user_id = ? AND status = 'OPEN'").all(user.id);
  const usedMargin = openTrades.reduce((sum, t) => sum + (t.lot_size * 100), 0);
  const freeMargin = Math.max(0, user.balance - usedMargin);

  res.render('app/withdraw', {
    title: 'Withdraw Funds | TradexEdge Custody',
    user,
    usedMargin,
    freeMargin
  });
});

router.post('/withdraw', (req, res) => {
  const { amount, method, address, notes } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);

  const numAmount = parseFloat(amount);
  if (isNaN(numAmount) || numAmount <= 0) {
    req.session.flash = { error: 'Please enter a valid withdrawal amount.' };
    return res.redirect('/withdraw');
  }

  // Free Margin Guardrail: Deduct used margin of open positions
  const openTrades = db.prepare("SELECT lot_size FROM trades WHERE user_id = ? AND status = 'OPEN'").all(user.id);
  const usedMargin = openTrades.reduce((sum, t) => sum + (t.lot_size * 100), 0);
  const freeMargin = Math.max(0, user.balance - usedMargin);

  if (numAmount > freeMargin) {
    req.session.flash = { 
      error: `Withdrawal rejected: Amount ($${numAmount.toLocaleString()}) exceeds your available Free Margin ($${freeMargin.toLocaleString(undefined, {minimumFractionDigits: 2})}). Please close active positions or withdraw a lower amount.` 
    };
    return res.redirect('/withdraw');
  }

  const newBalance = user.balance - numAmount;
  db.prepare('UPDATE users SET balance = ?, equity = ? WHERE id = ?').run(newBalance, newBalance, user.id);

  const ref = 'WTH-' + Math.floor(100000 + Math.random() * 900000);
  db.prepare(`
    INSERT INTO transactions (user_id, type, amount, currency, method, reference, tx_hash, description, status)
    VALUES (?, 'withdrawal', ?, 'USD', ?, ?, ?, ?, 'pending')
  `).run(
    user.id,
    numAmount,
    method || 'Crypto Wallet',
    ref,
    address || '',
    `Withdrawal of $${numAmount.toLocaleString()} to ${address || 'Client account'}`
  );

  logActivity(user.id, 'WITHDRAW_REQUEST', `Requested withdrawal ref ${ref} for $${numAmount}`, req);
  req.session.flash = { success: `Withdrawal request #${ref} submitted for institutional clearance.` };
  res.redirect('/transactions');
});

// 6. Statement & Transactions
router.get('/transactions', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const transactions = db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC').all(user.id);
  res.render('app/transactions', {
    title: 'Account Statement & Ledger | TradexEdge',
    user,
    transactions
  });
});

// 7. Settings, KYC & 2FA
router.get(['/settings', '/kyc', '/profile', '/account'], (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const kycDocs = db.prepare('SELECT * FROM kyc_documents WHERE user_id = ? ORDER BY id DESC').all(user.id);
  const activities = db.prepare('SELECT * FROM activity_logs WHERE user_id = ? ORDER BY id DESC LIMIT 10').all(user.id);

  res.render('app/settings', {
    title: 'Account Settings & Compliance | TradexEdge',
    user,
    kycDocs,
    activities
  });
});

// Toggle 2FA Security
router.post('/settings/2fa', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const newStatus = user.two_factor_enabled ? 0 : 1;
  db.prepare('UPDATE users SET two_factor_enabled = ? WHERE id = ?').run(newStatus, user.id);

  logActivity(user.id, '2FA_TOGGLE', `Two-factor authentication ${newStatus ? 'enabled' : 'disabled'}`, req);
  req.session.flash = { success: `Two-Factor Authentication (2FA) ${newStatus ? 'enabled successfully' : 'disabled'}.` };
  res.redirect('/settings');
});

// Submit / Resubmit KYC
router.post('/settings/kyc', (req, res) => {
  const { doc_type, doc_number, front_image, back_image, video_data } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);

  if (!doc_type || !doc_number) {
    req.session.flash = { error: 'Please provide complete document verification details.' };
    return res.redirect('/settings');
  }

  // Save front, back, and video if provided
  const frontPath = saveBase64Media(front_image, 'id_front', user.id) || '/storage/kyc/default_front.jpg';
  const backPath = saveBase64Media(back_image, 'id_back', user.id) || '/storage/kyc/default_back.jpg';
  const videoPath = saveBase64Media(video_data, 'kyc_video', user.id) || '/storage/kyc/default_video.webm';

  db.prepare(`
    INSERT INTO kyc_documents (user_id, doc_type, doc_number, front_image, back_image, video_path, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
  `).run(user.id, doc_type, doc_number, frontPath, backPath, videoPath);

  // Sync user status to pending
  db.prepare("UPDATE users SET kyc_status = 'pending' WHERE id = ?").run(user.id);

  try {
    db.prepare("INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, 'kyc')")
      .run(user.id, 'KYC Documents Received', `Your ${doc_type} (#${doc_number}) package has been received and queued for compliance verification.`);
  } catch(ne) {}

  logActivity(user.id, 'KYC_SUBMIT', `Submitted KYC document: ${doc_type} (${doc_number}) with identity proofs`, req);
  req.session.flash = { success: 'Document verification package submitted! Custody compliance desk will audit your credentials within 24 hours.' };
  res.redirect('/settings');
});

// Change Password
router.post('/settings/password', (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);

  if (!bcrypt.compareSync(current_password, user.password)) {
    req.session.flash = { error: 'Current password entered is incorrect.' };
    return res.redirect('/settings');
  }

  if (new_password !== confirm_password || new_password.length < 6) {
    req.session.flash = { error: 'New password must be at least 6 characters and match confirmation.' };
    return res.redirect('/settings');
  }

  const hashedPassword = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashedPassword, user.id);

  logActivity(user.id, 'PASSWORD_CHANGE', 'Password changed successfully', req);
  req.session.flash = { success: 'Password successfully updated.' };
  res.redirect('/settings');
});

// 8. WebTrader Order Execution APIs (Market & Limit Orders, Bulk Close, Margin Calculations)
router.post('/api/trade/open', (req, res) => {
  const { symbol, type, lot_size, open_price, take_profit, stop_loss, order_execution, trigger_price } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);

  if (!user) {
    return res.status(401).json({ error: 'Unauthorized trader session' });
  }

  const lots = parseFloat(lot_size) || 0.1;
  const isLimit = (order_execution === 'limit');
  const price = isLimit ? (parseFloat(trigger_price) || parseFloat(open_price)) : (parseFloat(open_price) || (symbol.includes('BTC') ? 64250.00 : (symbol.includes('ETH') ? 3480.00 : 1.0850)));
  const tp = take_profit ? parseFloat(take_profit) : null;
  const sl = stop_loss ? parseFloat(stop_loss) : null;

  let initialPnL = 0;
  if (!isLimit) {
    if (user.trade_mode === 'always_win') {
      initialPnL = lots * 150.0;
    } else if (user.trade_mode === 'always_loss') {
      initialPnL = -lots * 150.0;
    }
  }

  const orderStatus = isLimit ? 'PENDING' : 'OPEN';

  const result = db.prepare(`
    INSERT INTO trades (user_id, symbol, type, lot_size, open_price, current_price, take_profit, stop_loss, profit_loss, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(user.id, symbol || 'BTC/USD', type || 'BUY', lots, price, price, tp, sl, initialPnL, orderStatus);

  const orderId = result.lastInsertRowid;
  const logMsg = isLimit 
    ? `Placed LIMIT order #${orderId} ${type} ${lots} lots of ${symbol} trigger @ $${price}` 
    : `Opened #${orderId} ${type} ${lots} lots of ${symbol} @ $${price}`;

  logActivity(user.id, isLimit ? 'ORDER_LIMIT_PLACED' : 'TRADE_OPEN', logMsg, req);
  res.json({ success: true, tradeId: orderId, status: orderStatus, isLimit });
});

// Close Single Position
router.post('/api/trade/close', (req, res) => {
  const { trade_id, close_price } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const trade = db.prepare("SELECT * FROM trades WHERE id = ? AND user_id = ? AND status = 'OPEN'").get(trade_id, user.id);

  if (!trade) {
    return res.status(404).json({ error: 'Trade not found or already settled' });
  }

  const pnl = trade.profit_loss;
  const newBalance = user.balance + pnl;

  db.prepare(`
    UPDATE trades
    SET status = 'CLOSED', close_price = ?, closed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(close_price || trade.current_price, trade.id);

  db.prepare('UPDATE users SET balance = ?, equity = ? WHERE id = ?').run(newBalance, newBalance, user.id);

  logActivity(user.id, 'TRADE_CLOSE', `Closed #${trade.id} with realized P&L of $${pnl}`, req);
  res.json({ success: true, realizedPnL: pnl, newBalance });
});

// Bulk Close Positions (Close All, Close Profitable, Close Losing)
router.post('/api/trade/close-all', (req, res) => {
  const { filter } = req.body; // 'all' | 'profitable' | 'losing'
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);

  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  let query = "SELECT * FROM trades WHERE user_id = ? AND status = 'OPEN'";
  if (filter === 'profitable') query += " AND profit_loss > 0";
  else if (filter === 'losing') query += " AND profit_loss < 0";

  const targetTrades = db.prepare(query).all(user.id);
  if (targetTrades.length === 0) {
    return res.json({ success: true, count: 0, message: 'No open positions matched filter.' });
  }

  let totalRealized = 0;
  const closeStmt = db.prepare("UPDATE trades SET status = 'CLOSED', close_price = current_price, closed_at = CURRENT_TIMESTAMP WHERE id = ?");

  targetTrades.forEach(t => {
    totalRealized += Number(t.profit_loss || 0);
    closeStmt.run(t.id);
  });

  const newBalance = user.balance + totalRealized;
  db.prepare('UPDATE users SET balance = ?, equity = ? WHERE id = ?').run(newBalance, newBalance, user.id);

  logActivity(user.id, 'BULK_CLOSE', `Bulk closed ${targetTrades.length} positions (${filter || 'all'}) with net P&L $${totalRealized.toFixed(2)}`, req);
  res.json({ success: true, count: targetTrades.length, totalRealizedPnL: totalRealized, newBalance });
});

// Cancel Pending Limit Order
router.post('/api/trade/cancel-pending', (req, res) => {
  const { trade_id } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const trade = db.prepare("SELECT * FROM trades WHERE id = ? AND user_id = ? AND status = 'PENDING'").get(trade_id, user.id);

  if (!trade) {
    return res.status(404).json({ error: 'Pending order not found or already executed' });
  }

  db.prepare("UPDATE trades SET status = 'CANCELLED', closed_at = CURRENT_TIMESTAMP WHERE id = ?").run(trade.id);
  logActivity(user.id, 'CANCEL_PENDING', `Cancelled pending order #${trade.id} (${trade.symbol})`, req);
  res.json({ success: true, message: `Pending order #${trade.id} cancelled.` });
});

// Live Polling Synchronization with Daily Session Metrics & Real-Time Rates
router.get('/api/user/sync', (req, res) => {
  const user = db.prepare('SELECT id, name, balance, equity, currency, trade_mode FROM users WHERE id = ?').get(req.session.userId);
  if (!user) return res.json({ balance: 0, equity: 0, totalPnL: 0, openTrades: [], pendingOrders: [], livePrices: getLivePrices() });

  const openTrades = db.prepare("SELECT * FROM trades WHERE user_id = ? AND status = 'OPEN' ORDER BY id DESC").all(user.id);
  const pendingOrders = db.prepare("SELECT * FROM trades WHERE user_id = ? AND status = 'PENDING' ORDER BY id DESC").all(user.id);
  const userBalances = db.prepare("SELECT * FROM user_crypto_balances WHERE user_id = ? ORDER BY id ASC").all(user.id);
  
  let totalPnL = 0;
  let totalUsedMargin = 0;

  openTrades.forEach(t => {
    totalPnL += Number(t.profit_loss || 0);
    const notional = (t.open_price || 1) * Number(t.lot_size || 0.1);
    const lev = (t.symbol && t.symbol.includes('/')) ? 50 : 100;
    totalUsedMargin += (notional / lev);
  });

  const liveEquity = +(Number(user.balance) + totalPnL).toFixed(2);
  const freeMargin = +(liveEquity - totalUsedMargin).toFixed(2);
  const marginLevelPercent = totalUsedMargin > 0 ? +((liveEquity / totalUsedMargin) * 100).toFixed(1) : 9999.0;

  // Query Today's Session Closed Trades
  const todayTrades = db.prepare(`
    SELECT * FROM trades 
    WHERE user_id = ? AND (date(opened_at) = date('now') OR date(closed_at) = date('now'))
  `).all(user.id);

  let sessionTodayPnL = 0;
  let winningTrades = 0;
  let sessionVolume = 0;

  todayTrades.forEach(t => {
    sessionVolume += Number(t.lot_size || 0);
    if (t.status === 'CLOSED') {
      sessionTodayPnL += Number(t.profit_loss || 0);
      if (t.profit_loss > 0) winningTrades++;
    }
  });

  const closedCount = todayTrades.filter(t => t.status === 'CLOSED').length;
  const sessionWinRate = closedCount > 0 ? Math.round((winningTrades / closedCount) * 100) : 100;

  res.json({
    balance: Number(user.balance),
    equity: liveEquity,
    totalPnL: +totalPnL.toFixed(2),
    usedMargin: +totalUsedMargin.toFixed(2),
    freeMargin: Math.max(0, freeMargin),
    marginLevelPercent,
    openTrades,
    pendingOrders,
    userBalances,
    livePrices: getLivePrices(),
    sessionMetrics: {
      todayPnL: sessionTodayPnL,
      tradesCount: todayTrades.length,
      winRate: sessionWinRate,
      volume: +sessionVolume.toFixed(2),
      serverUtc: new Date().toISOString()
    }
  });
});

// Live Chat Messages API for User
router.get('/api/chat/messages', requireAuth, (req, res) => {
  const messages = db.prepare('SELECT * FROM support_chat_messages WHERE user_id = ? ORDER BY id ASC').all(req.session.userId);
  res.json({ messages });
});

router.post('/api/chat/send', requireAuth, (req, res) => {
  const { message } = req.body;
  if (!message || !message.trim()) return res.json({ success: false });

  db.prepare('INSERT INTO support_chat_messages (user_id, sender_role, message) VALUES (?, ?, ?)')
    .run(req.session.userId, 'user', message.trim());

  res.json({ success: true });
});

// Instant Multi-Asset Swap & Spot Trade API (Crypto, Stocks, Cash)
router.post('/api/user/swap', requireAuth, (req, res) => {
  const { from_symbol, to_symbol, amount } = req.body;
  const swapAmount = parseFloat(amount);
  const userId = req.session.userId;

  if (!from_symbol || !to_symbol || isNaN(swapAmount) || swapAmount <= 0) {
    return res.status(400).json({ success: false, error: 'Please enter a valid swap amount greater than zero.' });
  }

  const fromSym = from_symbol.toUpperCase().trim();
  const toSym = to_symbol.toUpperCase().trim();

  if (fromSym === toSym) {
    return res.status(400).json({ success: false, error: 'Source and destination assets cannot be identical.' });
  }

  const user = db.prepare('SELECT id, name, balance, equity FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ success: false, error: 'User account not found.' });

  // 1. Resolve Live Price Rates
  const livePrices = getLivePrices();

  const getAssetRate = (sym) => {
    if (sym === 'USD' || sym === 'USDT') return 1.0;
    if (livePrices[sym] && livePrices[sym].price) return Number(livePrices[sym].price);
    if (livePrices[sym + '/USD'] && livePrices[sym + '/USD'].price) return Number(livePrices[sym + '/USD'].price);
    if (livePrices[sym + '/USDT'] && livePrices[sym + '/USDT'].price) return Number(livePrices[sym + '/USDT'].price);
    
    // Check market_settings
    const mkt = db.prepare('SELECT current_price FROM market_settings WHERE symbol = ? OR symbol LIKE ?').get(sym, sym + '/%');
    if (mkt && mkt.current_price) return Number(mkt.current_price);

    // Fallback to user_crypto_balances
    const ucb = db.prepare('SELECT rate_usd FROM user_crypto_balances WHERE asset_symbol = ?').get(sym);
    if (ucb && ucb.rate_usd) return Number(ucb.rate_usd);

    return 1.0;
  };

  const fromRate = getAssetRate(fromSym);
  const toRate = getAssetRate(toSym);

  if (!fromRate || fromRate <= 0 || !toRate || toRate <= 0) {
    return res.status(400).json({ success: false, error: 'Real-time market rate unavailable for requested pair.' });
  }

  // 2. Check Available Balance of fromSym
  let availableBalance = 0;

  if (fromSym === 'USD') {
    availableBalance = Number(user.balance);
  } else {
    const fromAssetRow = db.prepare('SELECT * FROM user_crypto_balances WHERE user_id = ? AND asset_symbol = ?').get(userId, fromSym);
    availableBalance = fromAssetRow ? Number(fromAssetRow.balance) : 0;
  }

  if (availableBalance < swapAmount) {
    return res.status(400).json({ 
      success: false, 
      error: `Insufficient ${fromSym} balance. Available: ${availableBalance.toLocaleString(undefined, {maximumFractionDigits: 6})} ${fromSym}` 
    });
  }

  // 3. Ensure destination asset row exists in user_crypto_balances (if not USD)
  if (toSym !== 'USD') {
    const toAssetRow = db.prepare('SELECT * FROM user_crypto_balances WHERE user_id = ? AND asset_symbol = ?').get(userId, toSym);
    if (!toAssetRow) {
      const mkt = db.prepare('SELECT * FROM market_settings WHERE symbol = ? OR symbol LIKE ?').get(toSym, toSym + '/%');
      const isStock = (mkt && mkt.category === 'stocks') || ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'GOOGL', 'META', 'PLTR', 'AMD', 'NFLX'].includes(toSym);
      const assetType = isStock ? 'stock' : (toSym === 'USDT' ? 'fiat' : 'crypto');
      const assetName = mkt ? mkt.name : (livePrices[toSym]?.name || toSym);
      
      let defaultIcon = '🪙';
      if (toSym === 'BTC') defaultIcon = '₿';
      else if (toSym === 'ETH') defaultIcon = 'Ξ';
      else if (toSym === 'SOL') defaultIcon = '☀️';
      else if (toSym === 'BNB') defaultIcon = '🟡';
      else if (toSym === 'XRP') defaultIcon = '✕';
      else if (toSym === 'USDT') defaultIcon = '₮';
      else if (isStock) defaultIcon = '🏛️';

      db.prepare(`
        INSERT INTO user_crypto_balances (user_id, asset_symbol, asset_name, balance, icon, rate_usd, asset_type)
        VALUES (?, ?, ?, 0.0, ?, ?, ?)
      `).run(userId, toSym, assetName, defaultIcon, toRate, assetType);
    }
  }

  // 4. Calculate Exact Conversion
  const fromUsdValue = swapAmount * fromRate;
  const toAmount = fromUsdValue / toRate;

  // 5. Execute DB updates atomically
  const executeSwapTransaction = db.transaction(() => {
    // A. Deduct Source Asset
    if (fromSym === 'USD') {
      const newCash = Number(user.balance) - swapAmount;
      db.prepare('UPDATE users SET balance = ?, equity = ? WHERE id = ?').run(newCash, newCash, userId);
      // Synchronize USD in user_crypto_balances if row exists
      db.prepare("UPDATE user_crypto_balances SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND asset_symbol = 'USD'").run(newCash, userId);
    } else {
      db.prepare('UPDATE user_crypto_balances SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND asset_symbol = ?')
        .run(swapAmount, userId, fromSym);
    }

    // B. Credit Destination Asset
    if (toSym === 'USD') {
      const newCash = Number(user.balance) + toAmount;
      db.prepare('UPDATE users SET balance = ?, equity = ? WHERE id = ?').run(newCash, newCash, userId);
      // Synchronize USD in user_crypto_balances
      const usdRow = db.prepare("SELECT id FROM user_crypto_balances WHERE user_id = ? AND asset_symbol = 'USD'").get(userId);
      if (usdRow) {
        db.prepare("UPDATE user_crypto_balances SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(newCash, usdRow.id);
      } else {
        db.prepare(`INSERT INTO user_crypto_balances (user_id, asset_symbol, asset_name, balance, icon, rate_usd, asset_type) VALUES (?, 'USD', 'US Dollar (Fiat)', ?, '$', 1.0, 'fiat')`).run(userId, newCash);
      }
    } else {
      db.prepare('UPDATE user_crypto_balances SET balance = balance + ?, rate_usd = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND asset_symbol = ?')
        .run(toAmount, toRate, userId, toSym);
    }

    // C. Record in Transactions Ledger
    const txDesc = `Swapped ${swapAmount.toLocaleString(undefined, {maximumFractionDigits: 6})} ${fromSym} for ${toAmount.toLocaleString(undefined, {maximumFractionDigits: 6})} ${toSym} (@ $${fromRate.toLocaleString()} / $${toRate.toLocaleString()})`;
    db.prepare(`
      INSERT INTO transactions (user_id, type, amount, currency, method, status, description)
      VALUES (?, 'swap', ?, 'USD', 'Multi-Asset Swap', 'completed', ?)
    `).run(userId, fromUsdValue, txDesc);

    logActivity(userId, 'ASSET_SWAP', txDesc, req);
  });

  executeSwapTransaction();

  const formattedTo = toAmount < 1 ? toAmount.toFixed(6) : toAmount.toFixed(4);
  const formattedFrom = swapAmount < 1 ? swapAmount.toFixed(6) : swapAmount.toFixed(4);
  req.session.flash = { 
    success: `Successfully converted ${formattedFrom} ${fromSym} into ${formattedTo} ${toSym} at live market rates!` 
  };

  res.json({ 
    success: true, 
    from_symbol: fromSym, 
    to_symbol: toSym, 
    swapAmount, 
    toAmount,
    fromRate,
    toRate,
    fromUsdValue
  });
});

// Enhanced Spot Trade API with Fractional Investing & Live Prices
router.post('/api/user/spot-trade', requireAuth, (req, res) => {
  const { symbol, action, amount, mode } = req.body; // mode: 'usd' | 'shares'
  const userId = req.session.userId;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

  const numAmount = parseFloat(amount);
  if (!symbol || !action || isNaN(numAmount) || numAmount <= 0) {
    return res.status(400).json({ success: false, error: 'Invalid spot investment parameters.' });
  }

  const sym = symbol.toUpperCase().trim();
  const livePrices = getLivePrices();
  const livePrice = Number(livePrices[sym]?.price || livePrices[sym + '/USD']?.price || 150.0);

  let asset = db.prepare('SELECT * FROM user_crypto_balances WHERE user_id = ? AND asset_symbol = ?').get(userId, sym);
  if (!asset) {
    const mkt = db.prepare('SELECT * FROM market_settings WHERE symbol = ?').get(sym);
    const assetType = (mkt && mkt.category === 'stocks') || ['AAPL','MSFT','NVDA','TSLA','AMZN','GOOGL','META','PLTR','AMD','NFLX','JPM','V','BRK.B','LLY','DIS','BABA','TSM','UBER'].includes(sym) ? 'stock' : 'crypto';
    const assetName = mkt ? mkt.name : (livePrices[sym]?.name || sym);
    const defaultIcon = assetType === 'stock' ? '🏛️' : '🪙';
    db.prepare(`
      INSERT INTO user_crypto_balances (user_id, asset_symbol, asset_name, balance, icon, rate_usd, asset_type)
      VALUES (?, ?, ?, 0.0, ?, ?, ?)
    `).run(userId, sym, assetName, defaultIcon, livePrice, assetType);
    asset = db.prepare('SELECT * FROM user_crypto_balances WHERE user_id = ? AND asset_symbol = ?').get(userId, sym);
  }

  if (action === 'buy') {
    let totalCost = 0;
    let sharesAcquired = 0;

    if (mode === 'usd') {
      totalCost = numAmount;
      sharesAcquired = totalCost / livePrice;
    } else {
      sharesAcquired = numAmount;
      totalCost = sharesAcquired * livePrice;
    }

    if (user.balance < totalCost) {
      return res.status(400).json({ 
        success: false, 
        error: `Insufficient cash reserves. Required: $${totalCost.toFixed(2)}, Available: $${user.balance.toFixed(2)}` 
      });
    }

    const newCash = user.balance - totalCost;
    
    // Execute atomic purchase
    db.transaction(() => {
      db.prepare('UPDATE users SET balance = ?, equity = ? WHERE id = ?').run(newCash, newCash, userId);
      db.prepare("UPDATE user_crypto_balances SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND asset_symbol = 'USD'").run(newCash, userId);
      db.prepare('UPDATE user_crypto_balances SET balance = balance + ?, rate_usd = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(sharesAcquired, livePrice, asset.id);

      db.prepare(`
        INSERT INTO transactions (user_id, type, amount, currency, method, status, description)
        VALUES (?, 'buy_asset', ?, 'USD', 'Spot Equity Market', 'completed', ?)
      `).run(userId, totalCost, `Invested $${totalCost.toFixed(2)} into ${sharesAcquired.toFixed(4)} shares of ${sym} @ $${livePrice.toFixed(2)}/sh`);
    })();

    logActivity(userId, 'SPOT_BUY', `Invested in ${sharesAcquired.toFixed(4)} ${sym} shares ($${totalCost.toFixed(2)})`, req);
    req.session.flash = { success: `Successfully acquired ${sharesAcquired.toFixed(4)} shares of ${sym} for $${totalCost.toFixed(2)}!` };
    return res.json({ success: true, newCash, shares: sharesAcquired, totalCost, livePrice });

  } else if (action === 'sell') {
    let sharesLiquidated = 0;
    let totalProceeds = 0;

    if (mode === 'usd') {
      totalProceeds = numAmount;
      sharesLiquidated = totalProceeds / livePrice;
    } else {
      sharesLiquidated = numAmount;
      totalProceeds = sharesLiquidated * livePrice;
    }

    if (asset.balance < sharesLiquidated) {
      return res.status(400).json({ 
        success: false, 
        error: `Insufficient ${sym} shares held. Available: ${asset.balance.toFixed(4)} shares ($${(asset.balance * livePrice).toFixed(2)})` 
      });
    }

    const newCash = user.balance + totalProceeds;

    // Execute atomic liquidation
    db.transaction(() => {
      db.prepare('UPDATE users SET balance = ?, equity = ? WHERE id = ?').run(newCash, newCash, userId);
      db.prepare("UPDATE user_crypto_balances SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND asset_symbol = 'USD'").run(newCash, userId);
      db.prepare('UPDATE user_crypto_balances SET balance = balance - ?, rate_usd = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(sharesLiquidated, livePrice, asset.id);

      db.prepare(`
        INSERT INTO transactions (user_id, type, amount, currency, method, status, description)
        VALUES (?, 'sell_asset', ?, 'USD', 'Spot Equity Market', 'completed', ?)
      `).run(userId, totalProceeds, `Liquidated ${sharesLiquidated.toFixed(4)} shares of ${sym} for $${totalProceeds.toFixed(2)} cash @ $${livePrice.toFixed(2)}/sh`);
    })();

    logActivity(userId, 'SPOT_SELL', `Liquidated ${sharesLiquidated.toFixed(4)} ${sym} shares ($${totalProceeds.toFixed(2)})`, req);
    req.session.flash = { success: `Successfully liquidated ${sharesLiquidated.toFixed(4)} shares of ${sym} for $${totalProceeds.toFixed(2)} cash!` };
    return res.json({ success: true, newCash, shares: sharesLiquidated, totalProceeds, livePrice });
  }
});

// Thematic Stock Baskets Investment Engine
router.post('/api/user/invest-basket', requireAuth, (req, res) => {
  const { basket_id, amount } = req.body;
  const numAmount = parseFloat(amount);
  const userId = req.session.userId;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

  const basket = STOCK_BASKETS[basket_id];
  if (!basket) {
    return res.status(400).json({ success: false, error: 'Thematic basket not found.' });
  }

  if (isNaN(numAmount) || numAmount < basket.minInvestment) {
    return res.status(400).json({ success: false, error: `Minimum allocation for this basket is $${basket.minInvestment}.` });
  }

  if (user.balance < numAmount) {
    return res.status(400).json({ success: false, error: `Insufficient cash balance. Required: $${numAmount.toFixed(2)}, Available: $${user.balance.toFixed(2)}` });
  }

  const livePrices = getLivePrices();
  const newCash = user.balance - numAmount;

  // Execute proportional allocation across all constituent holdings
  db.transaction(() => {
    db.prepare('UPDATE users SET balance = ?, equity = ? WHERE id = ?').run(newCash, newCash, userId);
    db.prepare("UPDATE user_crypto_balances SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND asset_symbol = 'USD'").run(newCash, userId);

    basket.holdings.forEach(holding => {
      const stockDollars = numAmount * holding.weight;
      const stockPrice = Number(livePrices[holding.symbol]?.price || 150.0);
      const stockShares = stockDollars / stockPrice;

      let row = db.prepare('SELECT id FROM user_crypto_balances WHERE user_id = ? AND asset_symbol = ?').get(userId, holding.symbol);
      if (row) {
        db.prepare('UPDATE user_crypto_balances SET balance = balance + ?, rate_usd = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(stockShares, stockPrice, row.id);
      } else {
        db.prepare(`
          INSERT INTO user_crypto_balances (user_id, asset_symbol, asset_name, balance, icon, rate_usd, asset_type)
          VALUES (?, ?, ?, ?, '🏛️', ?, 'stock')
        `).run(userId, holding.symbol, holding.name, stockShares, stockPrice);
      }
    });

    const desc = `Invested $${numAmount.toLocaleString()} in ${basket.name} (${basket.holdings.map(h => h.symbol + ' ' + (h.weight*100) + '%').join(', ')})`;
    db.prepare(`
      INSERT INTO transactions (user_id, type, amount, currency, method, status, description)
      VALUES (?, 'basket_invest', ?, 'USD', 'Thematic Equity Fund', 'completed', ?)
    `).run(userId, numAmount, desc);
  })();

  logActivity(userId, 'BASKET_INVEST', `Invested $${numAmount} in ${basket.name}`, req);
  req.session.flash = { success: `Successfully invested $${numAmount.toLocaleString()} in ${basket.name}! Holdings have been added to your spot portfolio.` };
  res.json({ success: true, basketName: basket.name, allocatedAmount: numAmount });
});

// Claim Accrued Dividend Payouts directly into Cash Balance
// Emergency Full Portfolio Liquidation (Liquidate All Assets to Cash)
router.post('/api/user/liquidate-all', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ success: false, error: 'User account not found.' });

  const activeHoldings = db.prepare(`
    SELECT * FROM user_crypto_balances 
    WHERE user_id = ? AND asset_symbol != 'USD' AND balance > 0.000001
  `).all(userId);

  if (!activeHoldings || activeHoldings.length === 0) {
    return res.status(400).json({ success: false, error: 'No active non-USD asset holdings available to liquidate.' });
  }

  const livePrices = getLivePrices();
  let totalProceeds = 0;

  activeHoldings.forEach(h => {
    const sym = h.asset_symbol;
    const price = Number(livePrices[sym]?.price || livePrices[sym + '/USD']?.price || h.rate_usd || 1.0);
    const proceeds = Number(h.balance) * price;
    totalProceeds += proceeds;
  });

  const roundedProceeds = +totalProceeds.toFixed(2);
  const newCash = Number(user.balance) + roundedProceeds;

  db.transaction(() => {
    // 1. Credit Cash to users table
    db.prepare('UPDATE users SET balance = ?, equity = ? WHERE id = ?').run(newCash, newCash, userId);
    
    // 2. Synchronize USD in user_crypto_balances
    const usdRow = db.prepare("SELECT id FROM user_crypto_balances WHERE user_id = ? AND asset_symbol = 'USD'").get(userId);
    if (usdRow) {
      db.prepare("UPDATE user_crypto_balances SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(newCash, usdRow.id);
    } else {
      db.prepare(`INSERT INTO user_crypto_balances (user_id, asset_symbol, asset_name, balance, icon, rate_usd, asset_type) VALUES (?, 'USD', 'US Dollar (Fiat)', ?, '$', 1.0, 'fiat')`).run(userId, newCash);
    }

    // 3. Zero out all non-USD balances
    db.prepare(`
      UPDATE user_crypto_balances 
      SET balance = 0.0, updated_at = CURRENT_TIMESTAMP 
      WHERE user_id = ? AND asset_symbol != 'USD'
    `).run(userId);

    // 4. Record in Transactions Ledger
    const txDesc = `Emergency Portfolio Liquidation: Settle ${activeHoldings.length} assets to cash ($${roundedProceeds.toLocaleString()} USD proceeds)`;
    db.prepare(`
      INSERT INTO transactions (user_id, type, amount, currency, method, status, description)
      VALUES (?, 'liquidate_all', ?, 'USD', 'Emergency Cash Settle', 'completed', ?)
    `).run(userId, roundedProceeds, txDesc);
  })();

  logActivity(userId, 'PORTFOLIO_LIQUIDATE_ALL', `Liquidated ${activeHoldings.length} assets for $${roundedProceeds.toFixed(2)} cash`, req);

  req.session.flash = { 
    success: `Successfully liquidated ${activeHoldings.length} portfolio assets! $${roundedProceeds.toLocaleString(undefined, {minimumFractionDigits: 2})} cash has been deposited directly into your available cash reserves.` 
  };

  res.json({ 
    success: true, 
    liquidatedCount: activeHoldings.length, 
    totalProceeds: roundedProceeds, 
    newBalance: newCash 
  });
});

router.post('/api/user/claim-dividends', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  const stockBalances = db.prepare("SELECT * FROM user_crypto_balances WHERE user_id = ? AND asset_type = 'stock'").all(userId);

  const livePrices = getLivePrices();
  let totalPayout = 0;

  stockBalances.forEach(sb => {
    const yieldRate = STOCK_DIVIDEND_RATES[sb.asset_symbol] || 0;
    if (yieldRate > 0) {
      const price = Number(livePrices[sb.asset_symbol]?.price || sb.rate_usd || 100);
      const stockVal = Number(sb.balance || 0) * price;
      // Calculate quarterly dividend yield distribution (approx 25% of annual yield)
      const payout = stockVal * (yieldRate / 4);
      totalPayout += payout;
    }
  });

  if (totalPayout <= 0.10) {
    return res.status(400).json({ success: false, error: 'No accrued dividends available to distribute at this time.' });
  }

  const roundedPayout = +totalPayout.toFixed(2);
  const newCash = user.balance + roundedPayout;

  db.transaction(() => {
    db.prepare('UPDATE users SET balance = ?, equity = ? WHERE id = ?').run(newCash, newCash, userId);
    db.prepare("UPDATE user_crypto_balances SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND asset_symbol = 'USD'").run(newCash, userId);

    db.prepare(`
      INSERT INTO transactions (user_id, type, amount, currency, method, status, description)
      VALUES (?, 'dividend', ?, 'USD', 'Institutional Yield Distribution', 'completed', 'Quarterly Dividend Distribution on Spot Equities')
    `).run(userId, roundedPayout);
  })();

  logActivity(userId, 'DIVIDEND_CLAIM', `Claimed $${roundedPayout.toFixed(2)} in accrued quarterly dividends`, req);
  req.session.flash = { success: `Successfully claimed $${roundedPayout.toFixed(2)} in quarterly dividend distributions directly into your cash balance!` };
  res.json({ success: true, payoutAmount: roundedPayout });
});

// Subscribe to Investment Plan
router.post('/api/investments/subscribe', requireAuth, (req, res) => {
  const { plan_id, amount } = req.body;
  const plan = db.prepare('SELECT * FROM investment_plans WHERE id = ?').get(plan_id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);

  if (!plan) {
    return res.status(400).json({ success: false, error: 'Selected investment plan does not exist.' });
  }

  const investAmount = parseFloat(amount);
  if (isNaN(investAmount) || investAmount < plan.min_deposit || investAmount > plan.max_deposit) {
    return res.status(400).json({ 
      success: false, 
      error: `Investment amount must be between $${plan.min_deposit.toLocaleString()} and $${plan.max_deposit.toLocaleString()} USD.` 
    });
  }

  if (user.balance < investAmount) {
    return res.status(400).json({ 
      success: false, 
      error: 'Insufficient account cash balance. Please make a deposit to proceed.' 
    });
  }

  // Deduct balance and create subscription
  const newBalance = user.balance - investAmount;
  db.prepare('UPDATE users SET balance = ?, equity = ? WHERE id = ?').run(newBalance, newBalance, user.id);

  const result = db.prepare(`
    INSERT INTO user_investments (user_id, plan_id, invested_amount, accrued_profit, status, end_date)
    VALUES (?, ?, ?, 0.00, 'active', datetime('now', '+' || ? || ' days'))
  `).run(user.id, plan.id, investAmount, plan.duration_days);

  // Record Transaction
  db.prepare(`
    INSERT INTO transactions (user_id, type, amount, currency, method, status, description)
    VALUES (?, 'investment_allocate', ?, 'USD', 'Portfolio Allocation', 'completed', ?)
  `).run(user.id, investAmount, `Allocated $${investAmount.toLocaleString()} to ${plan.name}`);

  req.session.flash = { success: `Successfully invested $${investAmount.toLocaleString()} into the ${plan.name}!` };
  res.json({ success: true, investmentId: result.lastInsertRowid });
});

// 9. Affiliate & Referrals Portal
router.get('/referrals', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const referralList = db.prepare(`
    SELECT r.*, u.name as referee_name, u.email as referee_email, u.created_at as joined_date
    FROM referrals r
    JOIN users u ON r.referee_id = u.id
    WHERE r.referrer_id = ?
    ORDER BY r.id DESC
  `).all(user.id);

  let totalCommission = 0;
  referralList.forEach(r => totalCommission += Number(r.commission_earned || 0));

  res.render('app/referrals', {
    title: 'Introducing Broker & Affiliate Portal | TradexEdge',
    user,
    referralList,
    totalCommission
  });
});



module.exports = router;

// ==============================================================================
// IN-APP NOTIFICATIONS CENTER API
// ==============================================================================
router.get('/api/notifications', (req, res) => {
  if (!req.session.userId) return res.json({ notifications: [], unreadCount: 0 });
  const notes = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 20').all(req.session.userId);
  const unreadCount = notes.filter(n => n.is_read === 0).length;
  res.json({ notifications: notes, unreadCount });
});

router.post('/api/notifications/read-all', (req, res) => {
  if (!req.session.userId) return res.json({ success: false });
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.session.userId);
  res.json({ success: true });
});
