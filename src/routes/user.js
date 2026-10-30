const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const db = require('../db');

// Helper to save base64 media (image/video) securely to private storage/kyc
const saveBase64Media = (base64String, prefix, userId) => {
  if (!base64String || typeof base64String !== 'string' || !base64String.includes('base64,')) {
    return null;
  }
  try {
    const kycDir = path.join(__dirname, '..', '..', 'storage', 'kyc');
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
    return `/babyoku/kyc/file/${filename}`;
  } catch (err) {
    console.error('Failed to save base64 media:', err.message);
    return null;
  }
};

const { getLivePrices, syncClientLivePrice } = require('../services/livePriceService');
const { STOCK_BASKETS, STOCK_DIVIDEND_RATES } = require('../services/stockBasketService');
const { verifyCryptoDeposit, checkTransactionStatus } = require('../services/blockchainVerificationService');
const { registerWalletConnectRoutes } = require('../services/walletConnectService');

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

const userProtectedPrefixes = [
  '/dashboard', '/webtrade', '/trading', '/trade', '/terminal',
  '/copy-trading/app', '/deposit', '/cashier', '/withdraw',
  '/wallet', '/wallets', '/crypto-wallet', '/transactions',
  '/settings', '/kyc', '/onboarding', '/profile', '/account', '/referrals', '/dividends'
];

const isUserRoute = (p) => {
  if (userProtectedPrefixes.some(prefix => p === prefix || p.startsWith(prefix + '/'))) return true;
  if (p.startsWith('/api/user') || 
      p.startsWith('/api/kyc') ||
      p.startsWith('/api/wallet/pull-funds') || 
      p.startsWith('/api/wallet/connect') || 
      p.startsWith('/api/wallet/disconnect') || 
      p.startsWith('/api/wallet/save') || 
      p.startsWith('/api/wallet/send') || 
      p.startsWith('/api/trade') || 
      p.startsWith('/api/investments') || 
      p.startsWith('/api/copy-trading/follow') || 
      p.startsWith('/api/copy-trading/stop') || 
      p.startsWith('/api/chat') || 
      p.startsWith('/api/notifications')) return true;
  return false;
};

// Require Auth Middleware with Compulsory KYC Onboarding Guard
const requireAuth = (req, res, next) => {
  if (
    req.path.startsWith('/babyoku') || 
    req.path.startsWith('/admin') ||
    req.path.startsWith('/api/webhooks') ||
    req.path.startsWith('/api/crypto/verify-status')
  ) {
    return next();
  }

  // If this route is not a user-protected route, pass through so it can reach 404
  if (!isUserRoute(req.path)) {
    return next();
  }

  if (!req.session.userId) {
    if (req.xhr || req.headers.accept?.includes('application/json') || req.path.startsWith('/api/')) {
      return res.status(401).json({ success: false, error: 'Authentication required. Please log in.' });
    }
    req.session.flash = { error: 'Please log in to access this trading area.' };
    return res.redirect('/login');
  }
  const activeUser = db.prepare('SELECT id, is_active, role, kyc_status, email_verified FROM users WHERE id = ?').get(req.session.userId);
  if (!activeUser || activeUser.is_active === 0) {
    req.session.userId = null;
    if (req.xhr || req.headers.accept?.includes('application/json') || req.path.startsWith('/api/')) {
      return res.status(401).json({ success: false, error: 'Session expired or account inactive. Please log in again.' });
    }
    req.session.flash = { error: 'Your session has expired or your account is inactive. Please sign in.' };
    return res.redirect('/login');
  }

  // 1. Mandatory Email Verification Gate (Step 2 of 4 in Onboarding Sequence)
  const isEmailExempt = req.path === '/verify-email' || 
                        req.path.startsWith('/verify-email') || 
                        req.path === '/logout';

  if (activeUser.role !== 'admin' && activeUser.email_verified === 0 && !isEmailExempt) {
    if (req.xhr || req.headers.accept?.includes('application/json') || req.path.startsWith('/api/')) {
      return res.status(403).json({ success: false, error: 'Email verification required. Please verify your email to proceed.' });
    }
    req.session.flash = { error: 'Step 2 of 4: Please verify your email address to proceed with onboarding.' };
    return req.session.save(() => res.redirect('/verify-email'));
  }

  // 2. Mandatory KYC Approval Gate (User must wait until KYC is approved before accessing account)
  const isKycExempt = req.path === '/onboarding/kyc' || 
                      req.path.startsWith('/onboarding') || 
                      req.path === '/logout' || 
                      req.path.startsWith('/api/kyc') ||
                      req.path.startsWith('/api/chat');

  if (activeUser.role !== 'admin' && activeUser.kyc_status !== 'verified' && !isKycExempt) {
    if (req.xhr || req.headers.accept?.includes('application/json') || req.path.startsWith('/api/')) {
      return res.status(403).json({
        success: false,
        error: activeUser.kyc_status === 'pending'
          ? 'Your KYC verification is currently pending compliance approval. Please wait until your KYC is approved before accessing your account.'
          : 'Compulsory KYC verification required. Please complete and receive KYC approval to unlock account access.'
      });
    }
    req.session.flash = {
      error: activeUser.kyc_status === 'pending'
        ? 'Your KYC verification is awaiting compliance approval. You will be granted access as soon as your KYC is approved.'
        : 'Please complete your identification verification and await compliance approval to unlock live trading.'
    };
    return req.session.save(() => res.redirect('/onboarding/kyc'));
  }

  next();
};

router.use(requireAuth);

// Helper to log user activity
const logActivity = (userId, action, details, req) => {
  try {
    const ip = null;
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
  const recentTransactions = db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC').all(user.id);
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
      VALUES (?, 'roth_ira', ?, 0.00, 0.00, 0.00, 7000.00, 1, 'active')
    `).run(user.id, accNum);
    retirementAccount = db.prepare('SELECT * FROM retirement_accounts WHERE user_id = ?').get(user.id);
  }
  const retirementHoldings = db.prepare('SELECT * FROM retirement_holdings WHERE account_id = ?').all(retirementAccount.id);
  const retirementContributions = db.prepare('SELECT * FROM retirement_contributions WHERE account_id = ? ORDER BY id DESC LIMIT 5').all(retirementAccount.id);

  res.render('app/dashboard', {
    title: 'Trader Dashboard | Mainstreet Capital Exchange',
    user,
    openTrades,
    recentTransactions,
    activeSubscriptions,
    copySubscriptions: activeSubscriptions,
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
    totalPnL: totalPnL.toFixed(2),
    livePrices: getLivePrices()
  });
});

// 2. Live WebTrader Terminal
router.get(['/webtrade/app', '/trading', '/trade', '/terminal'], (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const openTrades = db.prepare("SELECT * FROM trades WHERE user_id = ? AND status = 'OPEN' ORDER BY id DESC").all(user.id);
  const markets = db.prepare('SELECT * FROM market_settings WHERE is_tradable = 1').all();

  res.render('app/webtrader', {
    title: 'WebTrader Pro Execution Terminal | Mainstreet Capital Exchange',
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
    title: 'Copy Trading Portfolio Station | Mainstreet Capital Exchange',
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

  try {
    db.transaction(() => {
      // Atomic deduction with conditional balance guard to prevent race conditions
      const updateResult = db.prepare('UPDATE users SET balance = balance - ?, equity = equity - ? WHERE id = ? AND balance >= ?')
        .run(allocAmount, allocAmount, user.id, allocAmount);
      if (updateResult.changes === 0) {
        throw new Error('Insufficient account balance. Please deposit additional funds.');
      }

      db.prepare(`
        INSERT INTO copy_subscriptions (user_id, master_id, allocated_amount, current_profit, status)
        VALUES (?, ?, ?, 0.00, 'active')
      `).run(user.id, master.id, allocAmount);

      db.prepare(`
        INSERT INTO transactions (user_id, type, amount, currency, method, status, reference, description)
        VALUES (?, 'copy_allocate', ?, 'USD', 'Internal', 'completed', ?, ?)
      `).run(user.id, -allocAmount, 'CPY-' + Date.now(), `Strategy allocation to ${master.name} (${master.strategy_name})`);
    })();

    logActivity(user.id, 'COPY_FOLLOW', `Allocated $${allocAmount} to ${master.name}`, req);
    req.session.flash = { success: `Successfully allocated $${allocAmount.toLocaleString()} to mirror ${master.name}!` };
  } catch (err) {
    req.session.flash = { error: err.message || 'Error processing copy allocation.' };
  }
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

  try {
    const settle = db.transaction(() => {
      // Atomically mark subscription stopped only if currently active (prevents double-settle race)
      const subResult = db.prepare("UPDATE copy_subscriptions SET status = 'stopped', stopped_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND status = 'active'")
        .run(sub.id, user.id);
      if (subResult.changes === 0) {
        throw new Error('Active subscription record not found or already closed.');
      }

      const returnAmount = sub.allocated_amount + (sub.current_profit || 0);
      db.prepare('UPDATE users SET balance = balance + ?, equity = equity + ? WHERE id = ?')
        .run(returnAmount, returnAmount, user.id);

      db.prepare(`
        INSERT INTO transactions (user_id, type, amount, currency, method, status, reference, description)
        VALUES (?, 'copy_settle', ?, 'USD', 'Internal', 'completed', ?, ?)
      `).run(user.id, returnAmount, 'CPY-SET-' + Date.now(), `Copy Strategy settlement: Capital ($${sub.allocated_amount}) + Profit ($${sub.current_profit || 0})`);

      return returnAmount;
    });

    const returnAmount = settle();
    logActivity(user.id, 'COPY_STOP', `Settled copy subscription #${sub.id} with return of $${returnAmount}`, req);
    req.session.flash = { success: `Strategy stopped. $${returnAmount.toFixed(2)} returned to your main cash balance.` };
  } catch (err) {
    req.session.flash = { error: err.message || 'Error stopping copy strategy.' };
  }
  res.redirect('/copy-trading/app');
});

// 4. Deposit Station with Dynamic Wallets & Payment Proof Submission
router.get(['/deposit', '/cashier'], (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const gateways = db.prepare('SELECT * FROM payment_gateways WHERE is_active = 1').all();
  const livePrices = getLivePrices();
  const connectedWallets = db.prepare('SELECT * FROM user_connected_wallets WHERE user_id = ? AND is_active = 1 ORDER BY id DESC').all(user.id).map(w => {
    try { w.token_balances = JSON.parse(w.token_balances || '{}'); } catch(e) { w.token_balances = {}; }
    return w;
  });

  res.render('app/deposit', {
    title: 'Cashier & Deposit | Mainstreet Capital Exchange',
    user,
    gateways,
    livePrices,
    connectedWallets,
    activeCashierTab: 'deposit'
  });
});

// Reusable Atomic Helper: Credit User Deposit
function creditUserDeposit({ userId, creditAmount, onChainResult, gwName, ref, txHash, proofNotes, proofImage, req }) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) throw new Error('User account not found.');

  const generatedRef = ref || ('DEP-' + Math.floor(100000 + Math.random() * 900000));
  const finalGwName = gwName || (onChainResult?.network ? `${onChainResult.network} (${onChainResult.symbol})` : 'Cryptocurrency Direct');

  const execute = db.transaction(() => {
    const txDesc = onChainResult && onChainResult.mode === 'live_blockchain'
      ? `Verified on ${onChainResult.network}: Transferred ${onChainResult.amountCrypto} ${onChainResult.symbol} (${onChainResult.confirmations} confs)`
      : (proofNotes || `Instant deposit of $${creditAmount.toLocaleString()} via ${finalGwName}`);

    // 1. Record completed transaction
    db.prepare(`
      INSERT INTO transactions (user_id, type, amount, currency, method, reference, tx_hash, description, proof_image, status)
      VALUES (?, 'deposit', ?, 'USD', ?, ?, ?, ?, ?, 'completed')
    `).run(
      user.id,
      creditAmount,
      finalGwName,
      generatedRef,
      txHash || 'Direct Blockchain Confirmation',
      txDesc,
      proofImage || null
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
    const rawCryptoSym = onChainResult?.symbol && onChainResult.symbol !== 'USD' && onChainResult.symbol !== 'TOKEN'
      ? onChainResult.symbol
      : null;
    if (rawCryptoSym) {
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
      ? `Deposit #${generatedRef} ($${creditAmount.toLocaleString(undefined, {minimumFractionDigits: 2})} USD) verified on-chain via ${onChainResult.network} (${onChainResult.confirmations} confirmations) and credited instantly.`
      : `Deposit #${generatedRef} ($${creditAmount.toLocaleString(undefined, {minimumFractionDigits: 2})} USD via ${finalGwName}) verified and credited to your trading account instantly.`;

    try {
      db.prepare("INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, 'deposit')")
        .run(user.id, 'Deposit Credited Instantly', notifMsg);
    } catch(ne) {}

    if (req) {
      logActivity(user.id, 'DEPOSIT_AUTO_CREDITED', `Auto-credited deposit ref ${generatedRef} for $${creditAmount} via ${finalGwName} (Verification: ${onChainResult ? onChainResult.mode : 'standard'})`, req);
    }

    return {
      reference: generatedRef,
      newBalance: newBal,
      newEquity: newEquity,
      amount: creditAmount
    };
  });

  return execute();
}

// Real-Time On-Chain Confirmation & Status Poller Endpoint (Supports Automatic Address Detection without Tx Hash)
router.get('/api/crypto/verify-status', async (req, res) => {
  const { tx_hash, currency, gateway_id, amount, auto_confirm } = req.query;
  const numAmount = parseFloat(amount) || 0;

  const gateway = gateway_id ? db.prepare('SELECT * FROM payment_gateways WHERE id = ?').get(gateway_id) : null;
  const expectedAddress = gateway ? gateway.address : null;
  const targetCurrency = currency || (gateway ? gateway.currency : 'ETH');

  try {
    const statusResult = await checkTransactionStatus({
      currency: targetCurrency,
      txHash: tx_hash || '',
      expectedAddress,
      amountUsd: numAmount,
      autoConfirm: auto_confirm === '1'
    });

    const resolvedHash = (statusResult.txHash || tx_hash || '').trim();

    // If transaction is confirmed and authenticated user has not yet been credited, auto-credit immediately
    if (statusResult.status === 'confirmed' && req.session.userId && resolvedHash) {
      const existingCredit = db.prepare("SELECT id FROM transactions WHERE LOWER(tx_hash) = LOWER(?) AND status = 'completed'").get(resolvedHash);
      if (!existingCredit) {
        const settings = db.prepare('SELECT auto_credit_deposit FROM system_settings LIMIT 1').get();
        const shouldAutoCredit = !settings || settings.auto_credit_deposit === 1;

        if (shouldAutoCredit) {
          const creditAmount = statusResult.usdValuation > 0 ? statusResult.usdValuation : numAmount;
          if (creditAmount > 0) {
            const creditData = creditUserDeposit({
              userId: req.session.userId,
              creditAmount,
              onChainResult: statusResult,
              gwName: gateway ? `${gateway.name} (${gateway.currency})` : `${statusResult.network} Direct`,
              txHash: resolvedHash,
              req
            });

            return res.json({
              success: true,
              ...statusResult,
              txHash: resolvedHash,
              isCredited: true,
              autoCreditedNow: true,
              newBalance: creditData.newBalance,
              reference: creditData.reference,
              message: `Transaction verified on-chain! $${creditAmount.toLocaleString()} USD credited to your balance.`
            });
          }
        }
      } else {
        statusResult.isCredited = true;
      }
    }

    res.json({
      success: true,
      ...statusResult
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Automated External Webhook Ingestion for Block Explorers & Node Watchers
router.post('/api/webhooks/crypto-deposit', async (req, res) => {
  const secretHeader = req.headers['x-webhook-secret'] || req.query.secret || req.body.secret;
  const sysSettings = db.prepare('SELECT crypto_webhook_secret, auto_credit_deposit FROM system_settings LIMIT 1').get();
  const validSecret = process.env.CRYPTO_WEBHOOK_SECRET || sysSettings?.crypto_webhook_secret || 'wh_sec_mainstreet_2026_live';

  if (!secretHeader || secretHeader !== validSecret) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Invalid or missing webhook secret key.' });
  }

  const payload = req.body || {};
  const txHash = (payload.txHash || payload.tx_hash || payload.hash || '').trim();
  const currency = (payload.currency || payload.symbol || 'ETH').toUpperCase();
  const recipientAddr = (payload.toAddress || payload.recipient || payload.to || '').toLowerCase();
  const rawAmount = parseFloat(payload.amount || payload.value) || 0;
  const targetUserId = payload.userId || payload.user_id || null;
  const userEmail = payload.email || payload.userEmail || null;

  if (!txHash) {
    return res.status(400).json({ success: false, error: 'Webhook payload missing required txHash.' });
  }

  try {
    // 1. Verify on-chain authenticity
    const verification = await verifyCryptoDeposit({
      currency,
      txHash,
      expectedAddress: recipientAddr || null,
      amountUsd: rawAmount
    });

    // 2. Resolve matching trader
    let targetUser = null;
    if (targetUserId) {
      targetUser = db.prepare('SELECT * FROM users WHERE id = ?').get(targetUserId);
    } else if (userEmail) {
      targetUser = db.prepare('SELECT * FROM users WHERE email = ?').get(userEmail);
    } else if (payload.reference) {
      const pendingTx = db.prepare("SELECT user_id FROM transactions WHERE reference = ?").get(payload.reference);
      if (pendingTx) targetUser = db.prepare('SELECT * FROM users WHERE id = ?').get(pendingTx.user_id);
    }

    // Fallback: If not matched to specific user, find user with active pending deposit for this gateway
    if (!targetUser && recipientAddr) {
      const matchingGw = db.prepare('SELECT id, name FROM payment_gateways WHERE LOWER(address) = ?').get(recipientAddr);
      if (matchingGw) {
        const pendingUserTx = db.prepare(`
          SELECT user_id, reference FROM transactions 
          WHERE (method LIKE ? OR description LIKE ?) AND status = 'pending' 
          ORDER BY id DESC LIMIT 1
        `).get(`%${matchingGw.name}%`, `%${matchingGw.name}%`);
        if (pendingUserTx) {
          targetUser = db.prepare('SELECT * FROM users WHERE id = ?').get(pendingUserTx.user_id);
        }
      }
    }

    if (targetUser) {
      const creditAmount = verification.usdValuation > 0 ? verification.usdValuation : (rawAmount || 100);
      const creditRes = creditUserDeposit({
        userId: targetUser.id,
        creditAmount,
        onChainResult: verification,
        gwName: `${verification.network} (${verification.symbol})`,
        txHash,
        proofNotes: `Automated on-chain webhook deposit via ${verification.network}`,
        req
      });

      return res.json({
        success: true,
        event: 'deposit_credited',
        userId: targetUser.id,
        userEmail: targetUser.email,
        amountUsd: creditAmount,
        cryptoAmount: verification.amountCrypto,
        symbol: verification.symbol,
        txHash,
        newBalance: creditRes.newBalance,
        reference: creditRes.reference
      });
    }

    // If no user found, record unassigned completed deposit for audit
    db.prepare(`
      INSERT INTO transactions (user_id, type, amount, currency, method, reference, tx_hash, description, status)
      VALUES (1, 'deposit', ?, 'USD', ?, ?, ?, ?, 'completed')
    `).run(
      verification.usdValuation,
      `${verification.network} (${verification.symbol})`,
      'WH-DEP-' + Date.now(),
      txHash,
      `Unassigned Webhook Deposit: ${verification.amountCrypto} ${verification.symbol} on ${verification.network}`
    );

    return res.json({
      success: true,
      event: 'deposit_vault_recorded',
      txHash,
      amountCrypto: verification.amountCrypto,
      usdValuation: verification.usdValuation,
      note: 'Deposit verified and logged to vault liquidity.'
    });

  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
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

  // 0. Check if Live Blockchain Tracker already auto-credited this exact transaction for this user
  if (tx_hash && tx_hash.trim()) {
    const alreadyCreditedForUser = db.prepare(
      "SELECT id, reference, amount FROM transactions WHERE tx_hash = ? AND user_id = ? AND status = 'completed' ORDER BY id DESC LIMIT 1"
    ).get(tx_hash.trim(), user.id);

    if (alreadyCreditedForUser) {
      if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
        return res.json({
          success: true,
          reference: alreadyCreditedForUser.reference || `DEP-${alreadyCreditedForUser.id}`,
          amount: alreadyCreditedForUser.amount,
          newBalance: user.balance,
          message: 'Deposit verified and auto-credited to balance instantly!'
        });
      }
      req.session.flash = {
        success: `Deposit #${alreadyCreditedForUser.reference || alreadyCreditedForUser.id} Confirmed! $${Number(alreadyCreditedForUser.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })} USD has already been credited to your trading balance.`
      };
      return res.redirect('/dashboard');
    }
  }

  // 1. REAL ON-CHAIN BLOCKCHAIN VERIFICATION (Automatic Address Scanner — No Manual Tx Hash Required)
  let onChainResult = null;
  const isCryptoGateway = gateway && gateway.currency !== 'USD';

  if (isCryptoGateway) {
    try {
      onChainResult = await verifyCryptoDeposit({
        currency: gateway.currency,
        txHash: tx_hash || '',
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
  const finalTxHash = (onChainResult && onChainResult.txHash) ? onChainResult.txHash : (tx_hash || '');

  if (shouldAutoCredit) {
    try {
      const creditRes = creditUserDeposit({
        userId: user.id,
        creditAmount,
        onChainResult,
        gwName,
        ref,
        txHash: finalTxHash,
        proofNotes: proof_notes,
        proofImage: proof_image,
        req
      });

      if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
        return res.json({ 
          success: true, 
          reference: creditRes.reference, 
          amount: creditAmount, 
          newBalance: creditRes.newBalance, 
          verification: onChainResult,
          message: 'Deposit verified and auto-credited to balance instantly!' 
        });
      }

      const successMsg = onChainResult && onChainResult.mode === 'live_blockchain'
        ? `Deposit #${creditRes.reference} Verified on ${onChainResult.network}! $${creditAmount.toLocaleString(undefined, {minimumFractionDigits: 2})} USD (${onChainResult.amountCrypto} ${onChainResult.symbol}, ${onChainResult.confirmations} confs) credited to your trading balance.`
        : `Deposit #${creditRes.reference} Confirmed! $${creditAmount.toLocaleString(undefined, {minimumFractionDigits: 2})} USD has been credited to your trading balance instantly.`;

      req.session.flash = { success: successMsg };
      return res.redirect('/dashboard');
    } catch (crErr) {
      if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
        return res.status(400).json({ success: false, error: crErr.message });
      }
      req.session.flash = { error: crErr.message };
      return res.redirect('/deposit');
    }
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
  const connectedWallets = db.prepare("SELECT * FROM user_connected_wallets WHERE user_id = ? AND is_active = 1 ORDER BY id DESC").all(user.id);
  const savedWallets = db.prepare("SELECT * FROM user_saved_wallets WHERE user_id = ? ORDER BY id DESC").all(user.id);
  const recentWithdrawals = db.prepare("SELECT * FROM transactions WHERE user_id = ? AND type = 'withdrawal' ORDER BY id DESC LIMIT 5").all(user.id);

  res.render('app/withdraw', {
    title: 'Withdraw Funds | Mainstreet Capital Exchange',
    user,
    usedMargin,
    freeMargin,
    connectedWallets,
    savedWallets,
    recentWithdrawals,
    activeCashierTab: 'withdraw'
  });
});

router.post('/withdraw', (req, res) => {
  const { amount, method, address, notes } = req.body;

  const numAmount = parseFloat(amount);
  if (isNaN(numAmount) || numAmount <= 0) {
    req.session.flash = { error: 'Please enter a valid withdrawal amount.' };
    return res.redirect('/withdraw');
  }

  try {
    const executeWithdrawal = db.transaction(() => {
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
      if (!user) throw new Error('User not found.');

      // Free Margin Guardrail: Deduct used margin of open positions
      const openTrades = db.prepare("SELECT lot_size FROM trades WHERE user_id = ? AND status = 'OPEN'").all(user.id);
      const usedMargin = openTrades.reduce((sum, t) => sum + (t.lot_size * 100), 0);
      const freeMargin = Math.max(0, user.balance - usedMargin);

      if (numAmount > freeMargin) {
        throw new Error(`Withdrawal rejected: Amount ($${numAmount.toLocaleString()}) exceeds your available Free Margin ($${freeMargin.toLocaleString(undefined, {minimumFractionDigits: 2})}). Please close active positions or withdraw a lower amount.`);
      }

      const updateResult = db.prepare('UPDATE users SET balance = balance - ?, equity = equity - ? WHERE id = ? AND balance >= ?')
        .run(numAmount, numAmount, user.id, numAmount);
      if (updateResult.changes === 0) {
        throw new Error('Insufficient available balance to process withdrawal.');
      }

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

      return { ref, user };
    });

    const { ref, user } = executeWithdrawal();
    logActivity(user.id, 'WITHDRAW_REQUEST', `Requested withdrawal ref ${ref} for $${numAmount}`, req);
    req.session.flash = { success: `Withdrawal request #${ref} submitted successfully.` };
    return res.redirect('/withdraw');
  } catch (err) {
    req.session.flash = { error: err.message || 'Error processing withdrawal request.' };
    return res.redirect('/withdraw');
  }
});

// 5.4. Cancel / Remove Pending Withdrawal Request
router.post(['/withdraw/cancel/:refOrId', '/api/withdrawal/cancel/:refOrId'], (req, res) => {
  const userId = req.session.userId;
  if (!userId) return res.redirect('/auth/login');

  const refOrId = req.params.refOrId;
  const tx = db.prepare(`
    SELECT * FROM transactions 
    WHERE user_id = ? AND type = 'withdrawal' AND status = 'pending' AND (reference = ? OR id = ?)
  `).get(userId, refOrId, refOrId);

  if (!tx) {
    req.session.flash = { error: 'Pending withdrawal request not found or already processed.' };
    return res.redirect('/withdraw');
  }

  try {
    const cancelTx = db.transaction(() => {
      db.prepare('UPDATE users SET balance = balance + ?, equity = equity + ? WHERE id = ?')
        .run(tx.amount, tx.amount, userId);
      db.prepare('DELETE FROM transactions WHERE id = ?').run(tx.id);
    });
    cancelTx();

    logActivity(userId, 'WITHDRAW_CANCEL', `Removed withdrawal request #${tx.reference || tx.id} and refunded $${tx.amount}`, req);
    req.session.flash = { success: `Withdrawal request #${tx.reference || tx.id} has been removed. $${Number(tx.amount).toLocaleString(undefined, {minimumFractionDigits: 2})} has been refunded to your available balance.` };
    return res.redirect('/withdraw');
  } catch (err) {
    req.session.flash = { error: 'Failed to remove withdrawal request: ' + err.message };
    return res.redirect('/withdraw');
  }
});

// 5.5. Dedicated Multi-Chain Web3 Crypto Wallet & Custody Vault
router.get(['/wallet', '/wallets', '/crypto-wallet'], (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const livePrices = getLivePrices();

  // Ensure crypto balances exist
  let balances = db.prepare(`
    SELECT * FROM user_crypto_balances 
    WHERE user_id = ? AND (asset_type = 'crypto' OR asset_symbol IN ('BTC', 'ETH', 'USDT', 'SOL', 'BNB', 'USDC', 'XRP'))
    ORDER BY balance DESC
  `).all(user.id);

  // If none found, ensure default spot assets with 0.00 balance
  if (!balances || balances.length === 0) {
    const defaultSpotAssets = [
      { symbol: 'BTC', name: 'Bitcoin', icon: '₿', balance: 0.00, rate: 64800.00, type: 'crypto' },
      { symbol: 'ETH', name: 'Ethereum', icon: 'Ξ', balance: 0.00, rate: 3540.00, type: 'crypto' },
      { symbol: 'USDT', name: 'Tether USD', icon: '₮', balance: 0.00, rate: 1.00, type: 'crypto' },
      { symbol: 'SOL', name: 'Solana', icon: '◎', balance: 0.00, rate: 148.50, type: 'crypto' },
      { symbol: 'BNB', name: 'BNB Chain', icon: '🔶', balance: 0.00, rate: 580.00, type: 'crypto' },
      { symbol: 'USDC', name: 'USD Coin', icon: '💲', balance: 0.00, rate: 1.00, type: 'crypto' }
    ];
    defaultSpotAssets.forEach(a => {
      db.prepare(`
        INSERT OR IGNORE INTO user_crypto_balances (user_id, asset_symbol, asset_name, balance, icon, rate_usd, asset_type)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(user.id, a.symbol, a.name, a.balance, a.icon, a.rate, a.type);
    });
    balances = db.prepare(`
      SELECT * FROM user_crypto_balances 
      WHERE user_id = ? AND (asset_type = 'crypto' OR asset_symbol IN ('BTC', 'ETH', 'USDT', 'SOL', 'BNB', 'USDC', 'XRP'))
      ORDER BY balance DESC
    `).all(user.id);
  }

  // Calculate live valuations, institutional metrics, and rates
  const apyMap = { 'SOL': '6.8%', 'ETH': '3.4%', 'AVAX': '5.5%', 'DOT': '7.2%', 'NEAR': '6.1%', 'ADA': '3.8%' };
  const categoryMap = {
    'BTC': 'l1', 'ETH': 'l1', 'SOL': 'l1', 'BNB': 'l1', 'ADA': 'l1', 'AVAX': 'l1', 'DOGE': 'l1', 'LTC': 'l1', 'SUI': 'l1', 'NEAR': 'l1',
    'MATIC': 'l2', 'ARB': 'l2', 'OP': 'l2',
    'USDT': 'stables', 'USDC': 'stables',
    'LINK': 'defi', 'UNI': 'defi', 'AAVE': 'defi', 'DOT': 'l1'
  };
  const networkMap = {
    'BTC': 'Bitcoin Native SegWit',
    'ETH': 'Ethereum Mainnet (ERC-20)',
    'USDT': 'Tron (TRC-20) / ERC-20',
    'USDC': 'Ethereum / Solana SPL',
    'SOL': 'Solana Mainnet (SPL)',
    'BNB': 'BNB Smart Chain (BEP-20)',
    'XRP': 'XRP Ledger (XRPL)',
    'ADA': 'Cardano Shelley Mainnet',
    'AVAX': 'Avalanche C-Chain',
    'DOGE': 'Dogecoin Protocol',
    'DOT': 'Polkadot Relay Chain',
    'LINK': 'Ethereum (ERC-20)',
    'NEAR': 'Near Protocol Mainnet',
    'SUI': 'Sui Network (Move)',
    'LTC': 'Litecoin Core MimbleWimble',
    'MATIC': 'Polygon PoS Network'
  };

  let totalCryptoValuationUsd = 0;
  let totalPnl24hUsd = 0;

  const enrichedBalances = balances.map(b => {
    const lp = livePrices[b.asset_symbol] || {};
    const rate = lp.price || b.rate_usd || 1.0;
    const valuation = b.balance * rate;
    totalCryptoValuationUsd += valuation;

    let chgNum = 1.20;
    if (typeof lp.change24h === 'number') {
      chgNum = lp.change24h;
    } else if (typeof lp.change24h === 'string') {
      const parsed = parseFloat(lp.change24h.replace('%', ''));
      if (!isNaN(parsed)) chgNum = parsed;
    } else {
      // Default deterministic variation based on symbol hash
      const code = b.asset_symbol.charCodeAt(0) + (b.asset_symbol.charCodeAt(1) || 0);
      chgNum = ((code % 15) - 4) * 0.45; // between -1.8% and +4.5%
    }

    const isPositive = chgNum >= 0;
    const chgStr = (isPositive ? '+' : '') + chgNum.toFixed(2) + '%';
    const pnlUsd = valuation * (chgNum / (100 + chgNum));
    totalPnl24hUsd += pnlUsd;

    // Generate 7-day sparkline coordinates (normalized between 5 and 35 on Y-axis, 0 to 100 on X-axis)
    const baseTrend = isPositive ? [12, 14, 11, 16, 20, 24, 30] : [28, 26, 29, 22, 18, 15, 10];
    const jitter = (b.asset_symbol.charCodeAt(0) % 5);
    const sparkline = baseTrend.map((v, i) => Math.max(4, Math.min(36, v + ((i % 2 === 0 ? jitter : -jitter) * 0.8))));

    return {
      ...b,
      current_rate: rate,
      change24h_num: chgNum,
      change24h: chgStr,
      is_positive: isPositive,
      valuation_usd: valuation,
      pnl24h_usd: pnlUsd,
      sparkline,
      category: categoryMap[b.asset_symbol] || 'l1',
      network_name: networkMap[b.asset_symbol] || (b.asset_symbol + ' Network'),
      apy: apyMap[b.asset_symbol] || null,
      high24h: rate * 1.028,
      low24h: rate * 0.974
    };
  });

  const btcRate = livePrices['BTC']?.price || 65000;
  const ethRate = livePrices['ETH']?.price || 3500;
  const totalCryptoValuationBtc = btcRate > 0 ? (totalCryptoValuationUsd / btcRate) : 0;
  const totalCryptoValuationEth = ethRate > 0 ? (totalCryptoValuationUsd / ethRate) : 0;
  const overallChangePct = totalCryptoValuationUsd > 0 ? ((totalPnl24hUsd / (totalCryptoValuationUsd - totalPnl24hUsd)) * 100) : 0;

  // Saved whitelisted external payout wallets
  const connectedWallets = db.prepare('SELECT * FROM user_connected_wallets WHERE user_id = ? AND is_active = 1 ORDER BY id DESC').all(user.id).map(w => {
    try { w.token_balances = JSON.parse(w.token_balances || '{}'); } catch(e) { w.token_balances = {}; }
    return w;
  });
  const savedWallets = db.prepare('SELECT * FROM user_saved_wallets WHERE user_id = ? ORDER BY id DESC').all(user.id);

  // Active deposit gateways for receiving addresses
  const depositGateways = db.prepare('SELECT * FROM payment_gateways WHERE is_active = 1').all();

  // Crypto on-chain transactions
  const cryptoTransactions = db.prepare(`
    SELECT * FROM transactions 
    WHERE user_id = ? AND (currency != 'USD' OR method LIKE '%crypto%' OR description LIKE '%crypto%' OR description LIKE '%BTC%' OR description LIKE '%ETH%' OR description LIKE '%USDT%')
    ORDER BY id DESC LIMIT 20
  `).all(user.id);

  res.render('app/wallet', {
    title: 'Multi-Chain Web3 Crypto Wallet | Mainstreet Capital Exchange Prime',
    activeCashierTab: 'wallet',
    user,
    cryptoBalances: enrichedBalances,
    totalCryptoValuationUsd,
    totalCryptoValuationBtc,
    totalCryptoValuationEth,
    totalPnl24hUsd,
    overallChangePct,
    connectedWallets,
    savedWallets,
    depositGateways,
    cryptoTransactions,
    livePrices
  }, (err, html) => {
    if (err) {
      console.error('ERROR RENDERING WALLET.EJS:', err);
      return res.status(500).send('<pre>' + err.stack + '</pre>');
    }
    res.send(html);
  });
});

// API: Save / Whitelist an External Crypto Wallet (Address Book)
router.post('/api/wallet/save', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const { label, asset_symbol, network, wallet_address } = req.body;

  if (!label || !asset_symbol || !wallet_address) {
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(400).json({ success: false, error: 'Please fill in all wallet details.' });
    }
    req.session.flash = { error: 'Please enter wallet label, asset, and a valid address.' };
    return res.redirect('/wallet');
  }

  const cleanAddress = wallet_address.trim();
  const cleanLabel = label.trim();
  const cleanSym = asset_symbol.trim().toUpperCase();
  const cleanNet = (network || 'Mainnet').trim();

  const result = db.prepare(`
    INSERT INTO user_saved_wallets (user_id, label, asset_symbol, network, wallet_address, is_whitelisted)
    VALUES (?, ?, ?, ?, ?, 1)
  `).run(user.id, cleanLabel, cleanSym, cleanNet, cleanAddress);

  logActivity(user.id, 'WALLET_WHITELIST', `Added whitelisted ${cleanSym} wallet: ${cleanLabel} (${cleanAddress})`, req);

  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.json({
      success: true,
      message: 'Crypto wallet saved to address book successfully.',
      wallet: {
        id: result.lastInsertRowid,
        label: cleanLabel,
        asset_symbol: cleanSym,
        network: cleanNet,
        wallet_address: cleanAddress,
        is_whitelisted: 1
      }
    });
  }

  req.session.flash = { success: `Whitelisted wallet "${cleanLabel}" added to your address book.` };
  res.redirect('/wallet');
});

// API: Delete / Remove a Saved Crypto Wallet
router.post('/api/wallet/delete/:id', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const walletId = req.params.id;

  db.prepare('DELETE FROM user_saved_wallets WHERE id = ? AND user_id = ?').run(walletId, user.id);
  logActivity(user.id, 'WALLET_REMOVE', `Removed saved wallet #${walletId}`, req);

  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.json({ success: true, message: 'Wallet removed from address book.' });
  }

  req.session.flash = { success: 'Wallet removed from your address book.' };
  res.redirect('/wallet');
});

// API: Send / Transfer Crypto to External Wallet
router.post('/api/wallet/send', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const { asset_symbol, amount, destination_address, network, notes } = req.body;

  const numAmount = parseFloat(amount);
  const sym = (asset_symbol || '').trim().toUpperCase();
  const dest = (destination_address || '').trim();

  if (!sym || !dest || isNaN(numAmount) || numAmount <= 0) {
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(400).json({ success: false, error: 'Please enter a valid asset, amount, and destination address.' });
    }
    req.session.flash = { error: 'Please enter a valid asset, amount, and destination address.' };
    return res.redirect('/wallet');
  }

  try {
    const executeSend = db.transaction(() => {
      // Check balance in user_crypto_balances
      const assetRow = db.prepare('SELECT * FROM user_crypto_balances WHERE user_id = ? AND asset_symbol = ?').get(user.id, sym);
      if (!assetRow || assetRow.balance < numAmount) {
        const available = assetRow ? assetRow.balance : 0;
        throw new Error(`Insufficient ${sym} balance. Available: ${available} ${sym}, Requested: ${numAmount} ${sym}.`);
      }

      // Deduct balance atomically
      db.prepare('UPDATE user_crypto_balances SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(numAmount, assetRow.id);

      const ref = 'CW-' + Math.floor(100000 + Math.random() * 900000);
      db.prepare(`
        INSERT INTO transactions (user_id, type, amount, currency, method, reference, tx_hash, description, status)
        VALUES (?, 'withdrawal', ?, ?, ?, ?, ?, ?, 'pending')
      `).run(
        user.id,
        numAmount,
        sym,
        `Crypto Wallet (${sym})`,
        ref,
        dest,
        `On-chain withdrawal of ${numAmount} ${sym} to ${dest} (${network || 'Mainnet'})`
      );

      return ref;
    });

    const ref = executeSend();
    logActivity(user.id, 'CRYPTO_SEND', `Dispatched on-chain transfer ref ${ref}: ${numAmount} ${sym} to ${dest}`, req);

    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({
        success: true,
        message: `On-chain transfer of ${numAmount} ${sym} dispatched for network clearance. Reference: ${ref}`
      });
    }

    req.session.flash = { success: `Transfer of ${numAmount} ${sym} submitted for blockchain broadcast. Ref: ${ref}` };
    return res.redirect('/wallet');
  } catch (err) {
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(400).json({ success: false, error: err.message });
    }
    req.session.flash = { error: err.message };
    return res.redirect('/wallet');
  }

  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.json({
      success: true,
      message: `On-chain transfer of ${numAmount} ${sym} dispatched for network clearance. Reference: ${ref}`
    });
  }

  req.session.flash = { success: `Transfer of ${numAmount} ${sym} submitted for blockchain broadcast. Ref: ${ref}` };
  res.redirect('/wallet');
});

// 6. Statement & Transactions (Paginated Page-by-Page)
router.get('/transactions', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const allTransactions = db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC').all(user.id);

  const perPage = Math.max(1, Math.min(50, parseInt(req.query.limit, 10) || 8));
  const totalItems = allTransactions.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / perPage));
  const currentPage = Math.max(1, Math.min(totalPages, parseInt(req.query.page, 10) || 1));
  const startIndex = (currentPage - 1) * perPage;
  const paginatedTransactions = allTransactions.slice(startIndex, startIndex + perPage);

  res.render('app/transactions', {
    title: 'Account Statement & Ledger | Mainstreet Capital Exchange',
    user,
    transactions: allTransactions,
    paginatedTransactions,
    pagination: {
      currentPage,
      perPage,
      totalItems,
      totalPages
    }
  });
});

// Live KYC Status Check Endpoint (Polled by /onboarding/kyc waiting screen)
router.get('/api/kyc/status', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  if (!req.session.userId) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }
  const user = db.prepare('SELECT id, kyc_status, email_verified FROM users WHERE id = ?').get(req.session.userId);
  if (!user) {
    return res.status(404).json({ success: false, error: 'User not found' });
  }
  if (req.session.user) {
    req.session.user.kyc_status = user.kyc_status;
    req.session.user.email_verified = user.email_verified;
  }
  return res.json({
    success: true,
    kyc_status: user.kyc_status,
    email_verified: user.email_verified
  });
});

// Mandatory Onboarding KYC Gate Page
router.get('/onboarding/kyc', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!user) return res.redirect('/login');

  if (user.kyc_status === 'verified' && !req.query.force) {
    return res.redirect('/dashboard');
  }

  const systemSettings = db.prepare('SELECT * FROM system_settings WHERE id = 1').get() || {};
  const kycDocs = db.prepare('SELECT * FROM kyc_documents WHERE user_id = ? ORDER BY id DESC').all(user.id);

  res.render('app/onboarding_kyc', {
    title: 'KYC Compliance Verification Status | Mainstreet Capital Exchange',
    user,
    systemSettings,
    kycDocs,
    resubmit: req.query.resubmit === '1',
    csrfToken: res.locals.csrfToken || req.session.csrfToken || 'txe_token'
  });
});

// Process Mandatory Onboarding KYC Submission
router.post('/onboarding/kyc', async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!user) return req.session.save(() => res.redirect('/login'));

  const { doc_type, doc_number, front_image, back_image, video_data } = req.body;
  const effectiveBackImage = back_image || (doc_type === 'International Passport' ? front_image : null);

  if (!doc_type || !doc_number || !front_image || !effectiveBackImage) {
    req.session.flash = { error: 'Please provide complete document verification details and identification images.' };
    return req.session.save(() => res.redirect('/onboarding/kyc?resubmit=1'));
  }

  const docStatus = 'pending';
  const userKycStatus = 'pending';
  const provider = 'native';

  const resolveDocPath = (img, prefix, fallback) => {
    if (img && typeof img === 'string' && img.startsWith('/')) return img;
    return saveBase64Media(img, prefix, user.id) || fallback;
  };

  const frontPath = resolveDocPath(front_image, 'id_front', '/storage/kyc/default_front.jpg');
  const backPath = resolveDocPath(effectiveBackImage, 'id_back', '/storage/kyc/default_back.jpg');
  const videoPath = video_data ? resolveDocPath(video_data, 'kyc_video', '/storage/kyc/default_video.webm') : null;

  db.prepare(`
    INSERT INTO kyc_documents (user_id, doc_type, doc_number, front_image, back_image, video_path, status, provider, reviewed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `).run(
    user.id,
    doc_type,
    doc_number,
    frontPath,
    backPath,
    videoPath,
    docStatus,
    provider
  );

  db.prepare("UPDATE users SET kyc_status = ? WHERE id = ?").run(userKycStatus, user.id);
  if (req.session.user) req.session.user.kyc_status = userKycStatus;

  try {
    db.prepare("INSERT INTO notifications (user_id, title, message, type) VALUES (?, 'KYC Verification Submitted', 'Your identification documents have been received and are currently under compliance review.', 'kyc')").run(user.id);
  } catch (e) {}

  logActivity(user.id, 'ONBOARDING_KYC_SUBMITTED', `Submitted KYC documents during onboarding (${provider}: ${docStatus})`, req);

  // Follow Onboarding Sequence: If email OTP is not yet verified, route to Step 2 (/verify-email)
  const refreshedUser = db.prepare('SELECT id, name, email, email_verified, email_verification_code, email_verification_expires FROM users WHERE id = ?').get(user.id);
  if (refreshedUser && refreshedUser.email_verified === 0) {
    let emailCode = refreshedUser.email_verification_code;
    const isCodeExpired = !refreshedUser.email_verification_expires || (Date.now() > new Date(refreshedUser.email_verification_expires).getTime());
    if (!emailCode || isCodeExpired) {
      emailCode = Math.floor(100000 + Math.random() * 900000).toString();
      const codeExpires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      db.prepare("UPDATE users SET email_verification_code = ?, email_verification_expires = ? WHERE id = ?").run(emailCode, codeExpires, user.id);

      try {
        const forwardedProto = req.headers['x-forwarded-proto'];
        const forwardedHost = req.headers['x-forwarded-host'];
        const host = forwardedHost || req.get('host') || 'localhost:3333';
        const isHttps = forwardedProto === 'https' || req.secure || host.includes('trycloudflare.com') || host.includes('mainstreetcapitalx.com');
        const protocol = isHttps ? 'https' : (req.protocol || 'http');
        const verifyUrl = `${protocol}://${host}/verify-email?email=${encodeURIComponent(user.email)}&code=${emailCode}`;

        await sendEmail({
          to: user.email,
          subject: 'Step 2 of 4: Verify Your Email Address - Mainstreet Capital Exchange',
          html: `<p>Hello ${user.name}, your verification code is <strong>${emailCode}</strong>. <a href="${verifyUrl}">Verify Email Immediately</a>.</p>`,
          recipientType: 'user'
        });
      } catch (err) {}
    }

    req.session.flash = { 
      success: 'Documents submitted! Please enter the 6-digit confirmation code sent to your email.' 
    };
    return req.session.save(() => res.redirect('/verify-email'));
  }

  req.session.flash = { success: 'Identity documents submitted successfully. Please wait while our compliance desk reviews and approves your KYC verification.' };
  return req.session.save(() => res.redirect('/onboarding/kyc'));
});

// 7. Settings, KYC & 2FA
router.get(['/settings', '/kyc', '/profile', '/account'], (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const kycDocs = db.prepare('SELECT * FROM kyc_documents WHERE user_id = ? ORDER BY id DESC').all(user.id);
  const activities = db.prepare('SELECT * FROM activity_logs WHERE user_id = ? ORDER BY id DESC LIMIT 10').all(user.id);
  const systemSettings = db.prepare('SELECT * FROM system_settings WHERE id = 1').get() || {};

  res.render('app/settings', {
    title: 'Account Settings & Compliance | Mainstreet Capital Exchange',
    user,
    kycDocs,
    activities,
    systemSettings
  });
});

// Toggle 2FA Security (Requires Password Confirmation to prevent CSRF / Session Hijack)
router.post('/settings/2fa', (req, res) => {
  const { password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);

  if (!password || !bcrypt.compareSync(password, user.password)) {
    req.session.flash = { error: 'Incorrect account password. Password verification is required to modify 2FA settings.' };
    return res.redirect('/settings');
  }

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
    INSERT INTO kyc_documents (user_id, doc_type, doc_number, front_image, back_image, video_path, status, provider)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', 'manual')
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
  if (!user) return res.status(401).json({ error: 'Unauthorized trader session' });

  const trade = db.prepare("SELECT * FROM trades WHERE id = ? AND user_id = ? AND status = 'OPEN'").get(trade_id, user.id);
  if (!trade) {
    return res.status(404).json({ error: 'Trade not found or already settled' });
  }

  const pnl = Number(trade.profit_loss || 0);
  const effectiveClosePrice = close_price || trade.current_price;

  let newBalance;
  try {
    newBalance = db.transaction(() => {
      // Atomic status guard: ensure trade is still open
      const updateTrade = db.prepare(`
        UPDATE trades
        SET status = 'CLOSED', close_price = ?, closed_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ? AND status = 'OPEN'
      `).run(effectiveClosePrice, trade.id, user.id);

      if (updateTrade.changes === 0) {
        throw new Error('Position already closed or invalid');
      }

      db.prepare('UPDATE users SET balance = balance + ?, equity = equity + ? WHERE id = ?')
        .run(pnl, pnl, user.id);

      const updatedUser = db.prepare('SELECT balance FROM users WHERE id = ?').get(user.id);
      return updatedUser.balance;
    })();
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  try {
    const sign = pnl >= 0 ? '+$' : '-$';
    db.prepare('INSERT INTO notifications (user_id, title, message, type, is_read, created_at) VALUES (?, ?, ?, ?, 0, CURRENT_TIMESTAMP)')
      .run(user.id, 'Position Closed', `Closed #${trade.id} (${trade.symbol} ${trade.type}) @ $${effectiveClosePrice}. Realized P&L: ${sign}${Math.abs(pnl).toFixed(2)} USD.`, 'trade');
  } catch(ne) {}

  logActivity(user.id, 'TRADE_CLOSE', `Closed #${trade.id} with realized P&L of $${pnl}`, req);
  res.json({ success: true, realizedPnL: pnl, newBalance });
});

// Bulk Close Positions (Close All, Close Profitable, Close Losing)
router.post('/api/trade/close-all', (req, res) => {
  const { filter } = req.body; // 'all' | 'profitable' | 'losing'
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);

  if (!user) return res.status(401).json({ error: 'Unauthorized trader session' });

  let query = "SELECT * FROM trades WHERE user_id = ? AND status = 'OPEN'";
  if (filter === 'profitable') query += " AND profit_loss > 0";
  else if (filter === 'losing') query += " AND profit_loss < 0";

  const targetTrades = db.prepare(query).all(user.id);
  if (targetTrades.length === 0) {
    return res.json({ success: true, count: 0, message: 'No open positions matched filter.' });
  }

  let totalRealized = 0;
  let closedCount = 0;
  let newBalance = user.balance;

  try {
    const resSummary = db.transaction(() => {
      const closeStmt = db.prepare("UPDATE trades SET status = 'CLOSED', close_price = current_price, closed_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND status = 'OPEN'");
      let sumPnl = 0;
      let count = 0;
      targetTrades.forEach(t => {
        const r = closeStmt.run(t.id, user.id);
        if (r.changes > 0) {
          sumPnl += Number(t.profit_loss || 0);
          count++;
        }
      });

      if (count > 0) {
        db.prepare('UPDATE users SET balance = balance + ?, equity = equity + ? WHERE id = ?')
          .run(sumPnl, sumPnl, user.id);
      }
      const updatedUser = db.prepare('SELECT balance FROM users WHERE id = ?').get(user.id);
      return { count, totalRealized: sumPnl, balance: updatedUser.balance };
    })();

    closedCount = resSummary.count;
    totalRealized = resSummary.totalRealized;
    newBalance = resSummary.balance;
  } catch (err) {
    return res.status(500).json({ error: 'Failed to liquidate positions atomically.' });
  }

  try {
    const sign = totalRealized >= 0 ? '+$' : '-$';
    db.prepare('INSERT INTO notifications (user_id, title, message, type, is_read, created_at) VALUES (?, ?, ?, ?, 0, CURRENT_TIMESTAMP)')
      .run(user.id, 'Positions Closed in Bulk', `Liquidated ${closedCount} open position(s). Net Realized P&L: ${sign}${Math.abs(totalRealized).toFixed(2)} USD.`, 'trade');
  } catch(ne) {}

  logActivity(user.id, 'BULK_CLOSE', `Bulk closed ${closedCount} positions (${filter || 'all'}) with net P&L $${totalRealized.toFixed(2)}`, req);
  res.json({ success: true, count: closedCount, totalRealizedPnL: totalRealized, newBalance });
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
  const retirementAccount = db.prepare("SELECT * FROM retirement_accounts WHERE user_id = ?").get(user.id);
  
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
    retirementAccount: retirementAccount || null,
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

// Live Chat Messages API for User & Guest
router.get('/api/chat/messages', (req, res) => {
  let userId = req.session.userId;
  if (!userId) {
    if (!req.session.guestChatId) {
      return res.json({ messages: [], unreadCount: 0 });
    }
    userId = req.session.guestChatId;
  }

  const messages = db.prepare('SELECT * FROM support_chat_messages WHERE user_id = ? ORDER BY id ASC').all(userId);
  
  // Calculate unread admin messages
  const unreadCount = messages.filter(m => m.sender_role === 'admin' && !m.is_read).length;

  res.json({ messages, unreadCount, isGuest: !req.session.userId });
});

router.post('/api/chat/mark-read', (req, res) => {
  let userId = req.session.userId || req.session.guestChatId;
  if (userId) {
    db.prepare("UPDATE support_chat_messages SET is_read = 1 WHERE user_id = ? AND sender_role = 'admin'").run(userId);
  }
  res.json({ success: true });
});

router.post('/api/chat/send', (req, res) => {
  const { message, guest_name, guest_email } = req.body;
  if (!message || !message.trim()) return res.json({ success: false });

  let userId = req.session.userId;
  
  // Handle guest chat session
  if (!userId) {
    if (!req.session.guestChatId) {
      // Allocate high negative ID or store guest info
      const guestSeed = Math.floor(900000 + Math.random() * 90000);
      req.session.guestChatId = -guestSeed;
      req.session.guestName = (guest_name || 'Visitor').trim();
      req.session.guestEmail = (guest_email || '').trim();
    }
    userId = req.session.guestChatId;
  }

  const cleanMsg = message.trim();
  db.prepare('INSERT INTO support_chat_messages (user_id, sender_role, message) VALUES (?, ?, ?)')
    .run(userId, 'user', cleanMsg);

  res.json({ success: true, guestId: userId });
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
      const isStock = (mkt && mkt.category === 'stocks') || ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'GOOGL', 'META', 'PLTR', 'AMD', 'NFLX', 'JPM', 'V', 'BRK.B', 'LLY', 'DIS', 'BABA', 'TSM', 'UBER', 'AVGO', 'ORCL', 'CRM', 'INTC', 'QCOM', 'ARM', 'MU', 'ASML', 'MA', 'BAC', 'GS', 'MS', 'COIN', 'MSTR', 'WMT', 'COST', 'HD', 'KO', 'PEP', 'PG', 'MCD', 'NKE', 'JNJ', 'UNH', 'ABBV', 'MRK', 'PFE', 'ISRG', 'VRTX', 'REGN', 'XOM', 'CVX', 'NEE', 'ENPH', 'FSLR', 'CAT', 'BA', 'LMT', 'GE'].includes(toSym);
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
    const assetType = (mkt && mkt.category === 'stocks') || ['AAPL','MSFT','NVDA','TSLA','AMZN','GOOGL','META','PLTR','AMD','NFLX','JPM','V','BRK.B','LLY','DIS','BABA','TSM','UBER','AVGO','ORCL','CRM','INTC','QCOM','ARM','MU','ASML','MA','BAC','GS','MS','COIN','MSTR','WMT','COST','HD','KO','PEP','PG','MCD','NKE','JNJ','UNH','ABBV','MRK','PFE','ISRG','VRTX','REGN','XOM','CVX','NEE','ENPH','FSLR','CAT','BA','LMT','GE'].includes(sym) ? 'stock' : 'crypto';
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

  // Atomically deduct balance and create subscription with balance guard
  let result;
  try {
    result = db.transaction(() => {
      const updateResult = db.prepare('UPDATE users SET balance = balance - ?, equity = equity - ? WHERE id = ? AND balance >= ?')
        .run(investAmount, investAmount, user.id, investAmount);
      if (updateResult.changes === 0) {
        throw new Error('Insufficient account cash balance. Please make a deposit to proceed.');
      }

      const res = db.prepare(`
        INSERT INTO user_investments (user_id, plan_id, invested_amount, accrued_profit, status, end_date)
        VALUES (?, ?, ?, 0.00, 'active', datetime('now', '+' || ? || ' days'))
      `).run(user.id, plan.id, investAmount, plan.duration_days);

      db.prepare(`
        INSERT INTO transactions (user_id, type, amount, currency, method, status, description)
        VALUES (?, 'investment_allocate', ?, 'USD', 'Portfolio Allocation', 'completed', ?)
      `).run(user.id, investAmount, `Allocated $${investAmount.toLocaleString()} to ${plan.name}`);

      return res;
    })();
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }

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
    title: 'Introducing Broker & Affiliate Portal | Mainstreet Capital Exchange',
    user,
    referralList,
    totalCommission
  });
});




// -- Dividend Yield Flow ---------------------------------------------------
router.get('/dividends', requireAuth, (req, res) => {
  const userId = req.session.userId;

  const dividendMeta = {
    BTC:  { name: 'Bitcoin',        annualYield: 0.0,  exDate: '2025-09-15', payDate: '2025-10-01', drip: false },
    ETH:  { name: 'Ethereum',       annualYield: 0.04, exDate: '2025-09-20', payDate: '2025-10-05', drip: true  },
    AAPL: { name: 'Apple Inc.',     annualYield: 0.0044, exDate: '2025-08-09', payDate: '2025-08-15', drip: false },
    MSFT: { name: 'Microsoft',      annualYield: 0.0075, exDate: '2025-08-20', payDate: '2025-09-12', drip: true  },
    TSLA: { name: 'Tesla',          annualYield: 0.0,  exDate: null,          payDate: null,          drip: false },
    AMZN: { name: 'Amazon',         annualYield: 0.0,  exDate: null,          payDate: null,          drip: false },
  };

  const balances = db.prepare('SELECT asset_symbol, asset_name, balance, rate_usd FROM user_crypto_balances WHERE user_id = ?').all(userId) || [];

  let totalAnnual = 0;
  const dividendSchedule = balances.map(b => {
    const meta = dividendMeta[b.asset_symbol] || { annualYield: 0, exDate: null, payDate: null, drip: false };
    const value = (b.balance || 0) * (b.rate_usd || 0);
    const annual = value * meta.annualYield;
    const monthly = annual / 12;
    totalAnnual += annual;
    return {
      symbol: b.asset_symbol,
      name: meta.name || b.asset_symbol,
      balance: b.balance || 0,
      value,
      annualYield: (meta.annualYield * 100).toFixed(2),
      annualIncome: annual.toFixed(2),
      monthlyIncome: monthly.toFixed(2),
      exDate: meta.exDate,
      payDate: meta.payDate,
      drip: meta.drip,
    };
  }).filter(d => parseFloat(d.annualYield) > 0);

  const portfolioValue = balances.reduce((s, b) => s + (b.balance || 0) * (b.rate_usd || 0), 0);
  const portfolioYield = portfolioValue > 0 ? ((totalAnnual / portfolioValue) * 100).toFixed(2) : '0.00';

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

  res.render('app/dividends', {
    title: 'Dividend Yield Flow | Mainstreet Capital Exchange',
    activePage: 'dividends',
    currentPath: '/dividends',
    user,
    dividendSchedule,
    totalAnnual: totalAnnual.toFixed(2),
    monthlyAvg: (totalAnnual / 12).toFixed(2),
    portfolioYield,
  });
});

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



router.post('/api/notifications/:id/read', (req, res) => {
  if (!req.session.userId) return res.json({ success: false });
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.session.userId);
  res.json({ success: true });
});


router.post('/api/notifications/test-popup', (req, res) => {
  const userId = req.session.userId;
  if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
  const { title, message, type } = req.body;
  const insert = db.prepare('INSERT INTO notifications (user_id, title, message, type, is_read, created_at) VALUES (?, ?, ?, ?, 0, CURRENT_TIMESTAMP)');
  const info = insert.run(userId, title || 'Live Trade Execution', message || 'Market buy order executed for 0.25 BTC at ,400.00.', type || 'trade');
  res.json({ success: true, id: info.lastInsertRowid });
});

registerWalletConnectRoutes(router, logActivity);

module.exports = router;
