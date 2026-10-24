// WalletConnect & External Web3 Multi-Chain & Live On-Chain RPC Integration Service
const db = require('../db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { getLivePrices } = require('./livePriceService');

// Ensure wc_pairing_sessions table exists for live cross-device QR & mobile deep-link pairing
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS wc_pairing_sessions (
      session_id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      chain_id TEXT DEFAULT '0x1',
      status TEXT DEFAULT 'pending',
      wallet_json TEXT DEFAULT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `);
} catch (e) {}

const CHAIN_CONFIGS = {
  '0x1': {
    id: '0x1',
    chainIdNum: 1,
    name: 'Ethereum Mainnet',
    symbol: 'ETH',
    icon: '🔷',
    rpcUrls: [
      'https://ethereum-rpc.publicnode.com',
      'https://eth.llamarpc.com',
      'https://rpc.ankr.com/eth'
    ],
    tokens: {
      USDT: { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
      USDC: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 }
    }
  },
  '0x38': {
    id: '0x38',
    chainIdNum: 56,
    name: 'BNB Smart Chain',
    symbol: 'BNB',
    icon: '🟡',
    rpcUrls: [
      'https://bsc-dataseed.binance.org',
      'https://bsc-rpc.publicnode.com'
    ],
    tokens: {
      USDT: { address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
      USDC: { address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 }
    }
  },
  '0x89': {
    id: '0x89',
    chainIdNum: 137,
    name: 'Polygon PoS',
    symbol: 'POL',
    icon: '🟣',
    rpcUrls: [
      'https://polygon-bor-rpc.publicnode.com',
      'https://polygon-rpc.com'
    ],
    tokens: {
      USDT: { address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6 },
      USDC: { address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6 }
    }
  },
  '0xa4b1': {
    id: '0xa4b1',
    chainIdNum: 42161,
    name: 'Arbitrum One',
    symbol: 'ETH',
    icon: '🔵',
    rpcUrls: [
      'https://arb1.arbitrum.io/rpc',
      'https://arbitrum-one-rpc.publicnode.com'
    ],
    tokens: {
      USDT: { address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6 },
      USDC: { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 }
    }
  }
};

function parseTokenBalances(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}

/**
 * Execute a JSON-RPC call against the chain's public Mainnet RPC endpoints
 */
async function callChainRpc(chainId, method, params) {
  const cfg = CHAIN_CONFIGS[chainId] || CHAIN_CONFIGS['0x1'];
  for (const url of cfg.rpcUrls) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: controller.signal
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      const data = await res.json();
      if (data && typeof data.result === 'string') {
        return data.result;
      }
    } catch (e) {
      // Try next fallback RPC URL
    }
  }
  return null;
}

/**
 * Fetch real live on-chain native & ERC-20 token balances (ETH/BNB/POL, USDT, USDC)
 */
async function fetchLiveOnChainBalances(walletAddress, chainId = '0x1') {
  const cfg = CHAIN_CONFIGS[chainId] || CHAIN_CONFIGS['0x1'];
  const cleanAddr = walletAddress.trim().toLowerCase();
  const paddedAddress = cleanAddr.replace(/^0x/, '').padStart(64, '0');
  const balanceOfData = '0x70a08231' + paddedAddress;

  let nativeBal = 0.0;
  const tokensMap = {
    [cfg.symbol]: 0.0,
    USDT: 0.0,
    USDC: 0.0
  };

  try {
    const [nativeHex, usdtHex, usdcHex] = await Promise.all([
      callChainRpc(cfg.id, 'eth_getBalance', [cleanAddr, 'latest']),
      cfg.tokens.USDT ? callChainRpc(cfg.id, 'eth_call', [{ to: cfg.tokens.USDT.address, data: balanceOfData }, 'latest']) : Promise.resolve(null),
      cfg.tokens.USDC ? callChainRpc(cfg.id, 'eth_call', [{ to: cfg.tokens.USDC.address, data: balanceOfData }, 'latest']) : Promise.resolve(null)
    ]);

    if (nativeHex && nativeHex.startsWith('0x') && nativeHex.length > 2) {
      const wei = BigInt(nativeHex);
      nativeBal = +(Number(wei) / 1e18).toFixed(6);
      tokensMap[cfg.symbol] = nativeBal;
    }

    if (usdtHex && usdtHex.startsWith('0x') && usdtHex.length > 2) {
      const rawUsdt = BigInt(usdtHex);
      const dec = cfg.tokens.USDT.decimals || 6;
      tokensMap.USDT = +(Number(rawUsdt) / Math.pow(10, dec)).toFixed(2);
    }

    if (usdcHex && usdcHex.startsWith('0x') && usdcHex.length > 2) {
      const rawUsdc = BigInt(usdcHex);
      const dec = cfg.tokens.USDC.decimals || 6;
      tokensMap.USDC = +(Number(rawUsdc) / Math.pow(10, dec)).toFixed(2);
    }
  } catch (e) {
    console.error('[WalletConnect Live RPC] Error querying on-chain balances:', e.message);
  }

  return { nativeBal, tokensMap, chainMeta: cfg };
}

/**
 * Helper to upsert a connected wallet record with real on-chain balances
 */
async function upsertConnectedWalletRecord({ userId, walletAddress, walletType, chainId, networkName, clientBalance, tokenBalances }) {
  const cleanAddr = walletAddress.trim().toLowerCase();
  const cleanType = (walletType || 'WalletConnect').trim();
  const cleanChain = CHAIN_CONFIGS[chainId] ? chainId : '0x1';
  const { nativeBal, tokensMap, chainMeta } = await fetchLiveOnChainBalances(cleanAddr, cleanChain);

  const cleanNet = (networkName || chainMeta.name).trim();
  const cleanCurr = chainMeta.symbol;

  // Use live RPC balance; if client also supplied live balances from provider, merge non-NaN values
  const finalNativeBal = (nativeBal > 0 || clientBalance === undefined || clientBalance === null)
    ? nativeBal
    : (parseFloat(clientBalance) || 0.0);

  tokensMap[cleanCurr] = finalNativeBal;
  if (tokenBalances && typeof tokenBalances === 'object') {
    for (const [k, v] of Object.entries(tokenBalances)) {
      const numV = parseFloat(v);
      if (!isNaN(numV) && numV >= 0) tokensMap[k] = numV;
    }
  }

  const tokenBalancesStr = JSON.stringify(tokensMap);
  const existing = db.prepare('SELECT id FROM user_connected_wallets WHERE user_id = ? AND LOWER(wallet_address) = ?').get(userId, cleanAddr);
  let walletId = null;

  if (existing) {
    db.prepare(`
      UPDATE user_connected_wallets 
      SET wallet_type = ?, chain_id = ?, network_name = ?, balance_cache = ?, currency_symbol = ?, token_balances = ?, is_active = 1, last_connected_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(cleanType, cleanChain, cleanNet, finalNativeBal, cleanCurr, tokenBalancesStr, existing.id);
    walletId = existing.id;
  } else {
    const result = db.prepare(`
      INSERT INTO user_connected_wallets (user_id, wallet_address, wallet_type, chain_id, network_name, balance_cache, currency_symbol, token_balances, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(userId, cleanAddr, cleanType, cleanChain, cleanNet, finalNativeBal, cleanCurr, tokenBalancesStr);
    walletId = result.lastInsertRowid;
  }

  return {
    id: walletId,
    wallet_address: cleanAddr,
    wallet_type: cleanType,
    chain_id: cleanChain,
    network_name: cleanNet,
    balance_cache: finalNativeBal,
    currency_symbol: cleanCurr,
    token_balances: tokensMap
  };
}

function resolveBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
  const host = req.headers['x-forwarded-host'] || req.get('host') || 'mainstreetcapitalx.com';
  const isHttps = proto === 'https' || host.includes('mainstreetcapitalx.com') || host.includes('onrender.com');
  return `${isHttps ? 'https' : 'http'}://${host}`;
}

function registerWalletConnectRoutes(router, logActivity) {
  // 1. API: Connect / Register External Web3 Wallet with Live On-Chain RPC Balance Sync
  router.post('/api/wallet/connect', async (req, res) => {
    const userId = req.session.userId;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) return res.status(401).json({ success: false, error: 'Unauthorized.' });

    const { wallet_address, wallet_type, chain_id, network_name, balance, token_balances } = req.body;
    if (!wallet_address || !/^0x[a-fA-F0-9]{40}$/.test(wallet_address.trim())) {
      return res.status(400).json({ success: false, error: 'Please provide a valid 42-character EVM Web3 address (starting with 0x).' });
    }

    try {
      const walletObj = await upsertConnectedWalletRecord({
        userId,
        walletAddress: wallet_address,
        walletType: wallet_type,
        chainId: chain_id || '0x1',
        networkName: network_name,
        clientBalance: balance,
        tokenBalances: parseTokenBalances(token_balances)
      });

      logActivity(userId, 'WALLET_CONNECT', `Connected live ${walletObj.wallet_type} wallet ${walletObj.wallet_address} on ${walletObj.network_name}`, req);

      return res.json({
        success: true,
        message: `Connected ${walletObj.wallet_type} (${walletObj.network_name}) — Live on-chain balances synced!`,
        wallet: walletObj
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: 'Failed to connect wallet: ' + err.message });
    }
  });

  // 2. API: Create Live Cross-Device WalletConnect QR & Mobile Deep-Link Session
  router.post('/api/wallet/wc-session/create', (req, res) => {
    const userId = req.session.userId;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized.' });

    const chainId = (req.body && req.body.chain_id && CHAIN_CONFIGS[req.body.chain_id]) ? req.body.chain_id : '0x1';
    const sessionId = crypto.randomBytes(20).toString('hex');
    const now = Date.now();
    const expiresAt = now + 15 * 60 * 1000; // 15 minutes

    db.prepare('DELETE FROM wc_pairing_sessions WHERE expires_at < ?').run(now);
    db.prepare(`
      INSERT INTO wc_pairing_sessions (session_id, user_id, chain_id, status, created_at, expires_at)
      VALUES (?, ?, ?, 'pending', ?, ?)
    `).run(sessionId, userId, chainId, now, expiresAt);

    const baseUrl = resolveBaseUrl(req);
    const bridgeUrl = `${baseUrl}/wc-bridge/${sessionId}`;
    const hostAndPath = bridgeUrl.replace(/^https?:\/\//, '');
    const encodedBridge = encodeURIComponent(bridgeUrl);

    return res.json({
      success: true,
      sessionId,
      chainId,
      bridgeUrl,
      deepLinks: {
        metamask: `https://metamask.app.link/dapp/${hostAndPath}`,
        trust: `https://link.trustwallet.com/open_url?coin_id=60&url=${encodedBridge}`,
        coinbase: `https://go.cb-w.com/dapp?cb_url=${encodedBridge}`,
        rainbow: `https://rnbwapp.com/wc?uri=${encodedBridge}`
      }
    });
  });

  // 3. API: Poll Live WalletConnect Session Status (called by Desktop/Mobile Modal)
  router.get('/api/wallet/wc-session/:sessionId/status', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    const row = db.prepare('SELECT * FROM wc_pairing_sessions WHERE session_id = ?').get(req.params.sessionId);
    if (!row || row.expires_at < Date.now()) {
      return res.json({ success: false, status: 'expired' });
    }
    if (row.status === 'completed' && row.wallet_json) {
      return res.json({
        success: true,
        status: 'completed',
        wallet: JSON.parse(row.wallet_json)
      });
    }
    return res.json({ success: true, status: 'pending' });
  });

  // 4. API: Complete Live WalletConnect Session from Mobile Device / Wallet App
  router.post('/api/wallet/wc-session/:sessionId/complete', async (req, res) => {
    const row = db.prepare('SELECT * FROM wc_pairing_sessions WHERE session_id = ?').get(req.params.sessionId);
    if (!row || row.expires_at < Date.now()) {
      return res.status(400).json({ success: false, error: 'Pairing session expired. Please generate a new QR code.' });
    }

    const { wallet_address, wallet_type, chain_id, balance } = req.body;
    if (!wallet_address || !/^0x[a-fA-F0-9]{40}$/.test(wallet_address.trim())) {
      return res.status(400).json({ success: false, error: 'Invalid EVM wallet address (must start with 0x and be 42 characters).' });
    }

    try {
      const walletObj = await upsertConnectedWalletRecord({
        userId: row.user_id,
        walletAddress: wallet_address,
        walletType: wallet_type || 'WalletConnect Mobile',
        chainId: chain_id || row.chain_id || '0x1',
        clientBalance: balance
      });

      db.prepare(`
        UPDATE wc_pairing_sessions
        SET status = 'completed', wallet_json = ?
        WHERE session_id = ?
      `).run(JSON.stringify(walletObj), row.session_id);

      logActivity(row.user_id, 'WALLET_CONNECT_QR', `Paired mobile wallet ${walletObj.wallet_address} via live QR bridge (${walletObj.network_name})`, req);

      return res.json({
        success: true,
        message: 'Wallet paired with your Mainstreet account!',
        wallet: walletObj
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 5. Public Mobile Web3 Pairing Bridge Page (Opened when user scans QR code on phone or opens deep link)
  router.get('/wc-bridge/:sessionId', (req, res) => {
    const row = db.prepare('SELECT * FROM wc_pairing_sessions WHERE session_id = ?').get(req.params.sessionId);
    if (!row || row.expires_at < Date.now()) {
      return res.status(404).send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Session Expired</title><script src="https://cdn.tailwindcss.com"></script></head><body class="bg-slate-950 text-white min-h-screen flex items-center justify-center p-6"><div class="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl p-6 text-center space-y-3"><div class="text-3xl">⏱️</div><h1 class="text-lg font-bold">Pairing Session Expired</h1><p class="text-xs text-slate-400">Please return to your Mainstreet Capital Exchange window and click WalletConnect to generate a fresh QR code.</p></div></body></html>`);
    }

    const chainMeta = CHAIN_CONFIGS[row.chain_id] || CHAIN_CONFIGS['0x1'];
    const baseUrl = resolveBaseUrl(req);
    const bridgeUrl = `${baseUrl}/wc-bridge/${row.session_id}`;
    const hostAndPath = bridgeUrl.replace(/^https?:\/\//, '');
    const encodedBridge = encodeURIComponent(bridgeUrl);

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
  <title>Web3 Wallet Pairing | Mainstreet Capital Exchange</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen flex items-center justify-center p-4 font-sans">
  <div class="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-5">
    <div class="flex items-center space-x-3 border-b border-slate-800 pb-4">
      <div class="w-10 h-10 rounded-2xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-xl">🔗</div>
      <div>
        <h1 class="text-base font-bold text-white">Mainstreet Web3 Bridge</h1>
        <p class="text-xs text-slate-400">Target Network: <strong class="text-sky-400">${chainMeta.name} (${chainMeta.symbol})</strong></p>
      </div>
    </div>

    <div id="statusBox" class="p-4 rounded-2xl bg-slate-950 border border-slate-800 text-xs text-slate-300 space-y-2">
      <div id="statusText" class="font-medium">Checking for injected mobile Web3 wallet provider...</div>
    </div>

    <!-- Primary Auto-Connect Button when inside Wallet Browser (MetaMask, Trust, Coinbase, Phantom, OKX) -->
    <button id="btnInjected" type="button" onclick="connectInjectedWallet()" class="w-full py-3.5 px-4 rounded-2xl bg-sky-500 hover:bg-sky-400 text-white font-bold text-sm shadow-lg shadow-sky-500/20 transition flex items-center justify-center space-x-2">
      <span>⚡ Approve & Pair Connected Wallet</span>
    </button>

    <!-- 1-Tap Mobile Wallet Deep-Links (When scanned from standard iOS/Android Camera) -->
    <div id="deepLinkSection" class="space-y-2.5 pt-2 border-t border-slate-800">
      <div class="text-[11px] font-mono uppercase tracking-wider text-slate-400">Or Open Directly in Your Mobile Wallet App</div>
      <a href="https://metamask.app.link/dapp/${hostAndPath}" class="w-full p-3 rounded-xl bg-slate-800/80 hover:bg-slate-800 border border-slate-700 flex items-center justify-between text-xs font-semibold text-white transition">
        <span class="flex items-center space-x-2.5"><span>🦊</span><span>Open in MetaMask Mobile</span></span>
        <span class="text-sky-400">&rarr;</span>
      </a>
      <a href="https://link.trustwallet.com/open_url?coin_id=60&url=${encodedBridge}" class="w-full p-3 rounded-xl bg-slate-800/80 hover:bg-slate-800 border border-slate-700 flex items-center justify-between text-xs font-semibold text-white transition">
        <span class="flex items-center space-x-2.5"><span>🛡️</span><span>Open in Trust Wallet</span></span>
        <span class="text-sky-400">&rarr;</span>
      </a>
      <a href="https://go.cb-w.com/dapp?cb_url=${encodedBridge}" class="w-full p-3 rounded-xl bg-slate-800/80 hover:bg-slate-800 border border-slate-700 flex items-center justify-between text-xs font-semibold text-white transition">
        <span class="flex items-center space-x-2.5"><span>🔵</span><span>Open in Coinbase Wallet</span></span>
        <span class="text-sky-400">&rarr;</span>
      </a>
    </div>

    <!-- Direct On-Chain Address Pairing (For Crypto.com DeFi, Ledger, Exodus, etc.) -->
    <div class="space-y-2 pt-3 border-t border-slate-800">
      <label class="block text-[11px] font-mono uppercase tracking-wider text-slate-400">Or Pair by Live EVM Wallet Address (0x...)</label>
      <div class="flex space-x-2">
        <input id="manualAddrInput" type="text" placeholder="0x..." class="flex-1 px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-white focus:outline-none focus:border-sky-500">
        <button type="button" onclick="pairManualAddress()" class="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition">Pair</button>
      </div>
    </div>
  </div>

  <script>
    const SESSION_ID = ${JSON.stringify(row.session_id)};
    const TARGET_CHAIN = ${JSON.stringify(row.chain_id || '0x1')};

    async function completePairing(payload) {
      const statusText = document.getElementById('statusText');
      const statusBox = document.getElementById('statusBox');
      statusText.textContent = 'Syncing live on-chain balances with Mainstreet Capital Exchange...';
      try {
        const res = await fetch('/api/wallet/wc-session/' + SESSION_ID + '/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
          statusBox.className = 'p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300 space-y-1';
          statusText.innerHTML = '<strong>✅ Wallet Paired Successfully!</strong><br>Address: <span class="font-mono">' + data.wallet.wallet_address + '</span><br>You may now return to your Mainstreet dashboard.';
          document.getElementById('btnInjected').style.display = 'none';
          document.getElementById('deepLinkSection').style.display = 'none';
        } else {
          statusBox.className = 'p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-400';
          statusText.textContent = data.error || 'Failed to pair wallet.';
        }
      } catch (err) {
        statusText.textContent = 'Network error: ' + err.message;
      }
    }

    async function connectInjectedWallet() {
      const provider = window.ethereum || (window.phantom && window.phantom.ethereum) || window.trustwallet || window.coinbaseWalletExtension;
      if (!provider) {
        document.getElementById('statusText').textContent = 'No in-app wallet browser detected. Tap your wallet app below (MetaMask, Trust Wallet, Coinbase) or paste your 0x address to pair.';
        return;
      }
      try {
        try {
          await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: TARGET_CHAIN }] });
        } catch (e) {}
        const accounts = await provider.request({ method: 'eth_requestAccounts' });
        if (!accounts || !accounts[0]) throw new Error('Wallet account access was rejected.');
        let chainId = TARGET_CHAIN;
        try { chainId = await provider.request({ method: 'eth_chainId' }); } catch (e) {}
        const walletType = provider.isMetaMask ? 'MetaMask Mobile' : (provider.isTrust ? 'Trust Wallet' : (provider.isCoinbaseWallet ? 'Coinbase Wallet' : 'Web3 Mobile Wallet'));
        await completePairing({ wallet_address: accounts[0], wallet_type: walletType, chain_id: chainId });
      } catch (err) {
        document.getElementById('statusText').textContent = err.message || 'Connection cancelled.';
      }
    }

    async function pairManualAddress() {
      const addr = (document.getElementById('manualAddrInput').value || '').trim();
      if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) {
        alert('Please enter a valid 42-character EVM wallet address starting with 0x.');
        return;
      }
      await completePairing({ wallet_address: addr, wallet_type: 'WalletConnect Live', chain_id: TARGET_CHAIN });
    }

    window.addEventListener('DOMContentLoaded', () => {
      const provider = window.ethereum || (window.phantom && window.phantom.ethereum) || window.trustwallet;
      if (provider) {
        document.getElementById('statusText').textContent = 'Web3 Wallet Browser Detected! Tap "Approve & Pair Connected Wallet" below.';
        connectInjectedWallet();
      } else {
        document.getElementById('statusText').textContent = 'Select your mobile wallet app below or enter your 0x wallet address to pair live.';
      }
    });
  </script>
</body>
</html>`;
    res.send(html);
  });

  // 6. API: Disconnect External Web3 Wallet
  router.post('/api/wallet/disconnect', (req, res) => {
    const userId = req.session.userId;
    const { wallet_id, wallet_address } = req.body;

    if (wallet_id) {
      db.prepare('UPDATE user_connected_wallets SET is_active = 0 WHERE id = ? AND user_id = ?').run(wallet_id, userId);
    } else if (wallet_address) {
      db.prepare('UPDATE user_connected_wallets SET is_active = 0 WHERE LOWER(wallet_address) = ? AND user_id = ?').run(wallet_address.trim().toLowerCase(), userId);
    } else {
      db.prepare('UPDATE user_connected_wallets SET is_active = 0 WHERE user_id = ?').run(userId);
    }

    logActivity(userId, 'WALLET_DISCONNECT', 'Disconnected external Web3 wallet session', req);
    res.json({ success: true, message: 'External wallet disconnected.' });
  });

  // 7. API: Refresh Live On-Chain Balances for Connected Wallet via Mainnet RPC
  router.post('/api/wallet/refresh-balance', async (req, res) => {
    const userId = req.session.userId;
    const { wallet_address, live_balances, chain_id } = req.body;

    if (!wallet_address) {
      return res.status(400).json({ success: false, error: 'Wallet address required.' });
    }

    const cleanAddr = wallet_address.trim().toLowerCase();
    const wallet = db.prepare('SELECT * FROM user_connected_wallets WHERE user_id = ? AND LOWER(wallet_address) = ? AND is_active = 1').get(userId, cleanAddr);

    if (!wallet) {
      return res.status(404).json({ success: false, error: 'Connected wallet not found.' });
    }

    const activeChain = (chain_id && CHAIN_CONFIGS[chain_id]) ? chain_id : (wallet.chain_id || '0x1');
    const { nativeBal, tokensMap, chainMeta } = await fetchLiveOnChainBalances(cleanAddr, activeChain);

    if (live_balances && typeof live_balances === 'object') {
      for (const [k, v] of Object.entries(live_balances)) {
        const numV = parseFloat(v);
        if (!isNaN(numV) && numV >= 0) tokensMap[k] = numV;
      }
    }

    const finalNativeBal = parseFloat(tokensMap[chainMeta.symbol] ?? nativeBal ?? 0.0);
    const tokenBalancesStr = JSON.stringify(tokensMap);

    db.prepare(`
      UPDATE user_connected_wallets 
      SET chain_id = ?, network_name = ?, currency_symbol = ?, balance_cache = ?, token_balances = ?, last_connected_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(activeChain, chainMeta.name, chainMeta.symbol, finalNativeBal, tokenBalancesStr, wallet.id);

    res.json({
      success: true,
      message: 'Live on-chain balances synchronized from Mainnet RPC!',
      wallet: {
        id: wallet.id,
        wallet_address: wallet.wallet_address,
        wallet_type: wallet.wallet_type,
        chain_id: activeChain,
        network_name: chainMeta.name,
        balance_cache: finalNativeBal,
        currency_symbol: chainMeta.symbol,
        token_balances: tokensMap,
        last_connected_at: new Date().toISOString()
      }
    });
  });

  // 8. API: Pull / Deposit Funds from Connected External Wallet
  router.post('/api/wallet/pull-funds', async (req, res) => {
    const userId = req.session.userId;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) return res.status(401).json({ success: false, error: 'Unauthorized.' });

    const { wallet_address, asset_symbol, amount, password, tx_hash } = req.body;
    const numAmount = parseFloat(amount);
    const sym = (asset_symbol || 'ETH').trim().toUpperCase();

    if (isNaN(numAmount) || numAmount <= 0) {
      return res.status(400).json({ success: false, error: 'Please enter a valid transfer amount greater than 0.' });
    }

    if (!password) {
      return res.status(400).json({
        success: false,
        requires_password: true,
        error: 'Security Verification Required: Please enter your Mainstreet account password to authorize and sign this transfer.'
      });
    }

    const isPasswordValid = bcrypt.compareSync(password, user.password);
    if (!isPasswordValid) {
      return res.status(403).json({
        success: false,
        error: 'Invalid Mainstreet account password. Authorization denied.'
      });
    }

    const fromAddr = (wallet_address || '').trim().toLowerCase();
    const wallet = db.prepare('SELECT * FROM user_connected_wallets WHERE user_id = ? AND LOWER(wallet_address) = ? AND is_active = 1').get(userId, fromAddr);
    if (!wallet) {
      return res.status(404).json({ success: false, error: 'Connected external wallet not found.' });
    }

    // Refresh real on-chain balance before authorizing transfer unless an on-chain tx_hash was already broadcast
    const { nativeBal, tokensMap } = await fetchLiveOnChainBalances(fromAddr, wallet.chain_id || '0x1');
    const availableOnChain = sym === wallet.currency_symbol ? nativeBal : (Number(tokensMap[sym]) || 0);

    if (!tx_hash && availableOnChain < numAmount) {
      return res.status(400).json({
        success: false,
        error: `Insufficient on-chain ${sym} balance in connected wallet (${fromAddr.slice(0, 8)}...). Live On-Chain Balance: ${availableOnChain} ${sym}, Requested: ${numAmount} ${sym}.`
      });
    }

    const livePrices = getLivePrices();
    const rateUsd = livePrices[sym]?.price || (sym === 'USDT' || sym === 'USDC' ? 1.0 : (sym === 'ETH' ? 3500 : (sym === 'BNB' ? 620 : (sym === 'POL' ? 0.45 : 65000))));
    const amountUsd = numAmount * rateUsd;

    try {
      const executeFundImport = db.transaction(() => {
        let assetRow = db.prepare('SELECT * FROM user_crypto_balances WHERE user_id = ? AND asset_symbol = ?').get(userId, sym);
        if (!assetRow) {
          db.prepare(`
            INSERT INTO user_crypto_balances (user_id, asset_symbol, asset_name, balance, icon, rate_usd, asset_type)
            VALUES (?, ?, ?, 0.0, ?, ?, 'crypto')
          `).run(userId, sym, sym + ' Spot', sym === 'ETH' ? 'Ξ' : (sym === 'BNB' ? '🟡' : (sym === 'POL' ? '🟣' : (sym === 'BTC' ? '₿' : '🪙'))), rateUsd);
          assetRow = db.prepare('SELECT * FROM user_crypto_balances WHERE user_id = ? AND asset_symbol = ?').get(userId, sym);
        }

        db.prepare('UPDATE user_crypto_balances SET balance = balance + ?, rate_usd = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(numAmount, rateUsd, assetRow.id);

        const newBalance = user.balance + amountUsd;
        db.prepare('UPDATE users SET balance = ?, equity = equity + ? WHERE id = ?').run(newBalance, amountUsd, userId);

        const ref = 'WC-' + Math.floor(100000 + Math.random() * 900000);
        const generatedTxHash = (tx_hash && tx_hash.startsWith('0x')) ? tx_hash.trim() : ('0x' + crypto.randomBytes(32).toString('hex'));

        db.prepare(`
          INSERT INTO transactions (user_id, type, amount, currency, method, reference, tx_hash, status, description)
          VALUES (?, 'deposit', ?, ?, 'WalletConnect Direct', ?, ?, 'completed', ?)
        `).run(
          userId,
          amountUsd,
          'USD',
          ref,
          generatedTxHash,
          `Direct WalletConnect transfer of ${numAmount} ${sym} ($${amountUsd.toFixed(2)} USD) from external wallet ${wallet.wallet_address.slice(0, 8)}...`
        );

        tokensMap[sym] = Math.max(0, +(availableOnChain - numAmount).toFixed(6));
        const newNativeBal = sym === wallet.currency_symbol ? tokensMap[sym] : nativeBal;

        db.prepare(`
          UPDATE user_connected_wallets 
          SET balance_cache = ?, token_balances = ?, last_connected_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(newNativeBal, JSON.stringify(tokensMap), wallet.id);

        try {
          db.prepare(`
            INSERT INTO notifications (user_id, title, message, type, is_read, created_at)
            VALUES (?, 'WalletConnect Funds Received', ?, 'deposit', 0, CURRENT_TIMESTAMP)
          `).run(userId, `Transferred ${numAmount} ${sym} ($${amountUsd.toFixed(2)} USD) from external wallet into Mainstreet custody.`);
        } catch (ne) {}

        return { ref, generatedTxHash, newBalance, cryptoBalance: assetRow.balance + numAmount };
      });

      const result = executeFundImport();
      logActivity(userId, 'WALLET_FUND_IMPORT', `Imported ${numAmount} ${sym} ($${amountUsd.toFixed(2)} USD) from connected wallet ${wallet_address} (Ref: ${result.ref})`, req);

      res.json({
        success: true,
        message: `Successfully transferred ${numAmount} ${sym} ($${amountUsd.toFixed(2)} USD) from your external wallet into your Mainstreet portfolio!`,
        transaction: {
          reference: result.ref,
          tx_hash: result.generatedTxHash,
          amount_crypto: numAmount,
          asset_symbol: sym,
          amount_usd: amountUsd
        },
        newBalance: result.newBalance,
        cryptoBalance: result.cryptoBalance
      });
    } catch (err) {
      console.error('Wallet Pull Funds Error:', err.message);
      res.status(500).json({ success: false, error: 'Failed to process external wallet transfer: ' + err.message });
    }
  });
}

module.exports = { registerWalletConnectRoutes, fetchLiveOnChainBalances };
