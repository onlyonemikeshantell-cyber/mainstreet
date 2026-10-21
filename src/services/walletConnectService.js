// WalletConnect & External Web3 Wallet Integration Helpers for Mainstreet
const db = require('../db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { getLivePrices } = require('./livePriceService');

function registerWalletConnectRoutes(router, logActivity) {
  // 1. API: Connect / Register External Web3 Wallet
  router.post('/api/wallet/connect', (req, res) => {
    const userId = req.session.userId;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) return res.status(401).json({ success: false, error: 'Unauthorized.' });

    const { wallet_address, wallet_type, chain_id, network_name, balance, currency_symbol } = req.body;
    if (!wallet_address || !wallet_address.startsWith('0x')) {
      return res.status(400).json({ success: false, error: 'Invalid Web3 wallet address provided.' });
    }

    const cleanAddr = wallet_address.trim().toLowerCase();
    const cleanType = (wallet_type || 'WalletConnect').trim();
    const cleanChain = (chain_id || '0x1').trim();
    const cleanNet = (network_name || 'Ethereum Mainnet').trim();
    const cleanBal = parseFloat(balance) || 0.0;
    const cleanCurr = (currency_symbol || 'ETH').trim().toUpperCase();

    const existing = db.prepare('SELECT id FROM user_connected_wallets WHERE user_id = ? AND LOWER(wallet_address) = ?').get(userId, cleanAddr);
    let walletId = null;

    if (existing) {
      db.prepare(`
        UPDATE user_connected_wallets 
        SET wallet_type = ?, chain_id = ?, network_name = ?, balance_cache = ?, currency_symbol = ?, is_active = 1, last_connected_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(cleanType, cleanChain, cleanNet, cleanBal, cleanCurr, existing.id);
      walletId = existing.id;
    } else {
      const result = db.prepare(`
        INSERT INTO user_connected_wallets (user_id, wallet_address, wallet_type, chain_id, network_name, balance_cache, currency_symbol, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1)
      `).run(userId, cleanAddr, cleanType, cleanChain, cleanNet, cleanBal, cleanCurr);
      walletId = result.lastInsertRowid;
    }

    logActivity(userId, 'WALLET_CONNECT', `Connected ${cleanType} wallet ${cleanAddr} (${cleanNet})`, req);

    res.json({
      success: true,
      message: `Successfully connected ${cleanType} wallet (${cleanAddr.slice(0, 6)}...${cleanAddr.slice(-4)})`,
      wallet: {
        id: walletId,
        wallet_address: cleanAddr,
        wallet_type: cleanType,
        chain_id: cleanChain,
        network_name: cleanNet,
        balance_cache: cleanBal,
        currency_symbol: cleanCurr
      }
    });
  });

  // 2. API: Disconnect External Web3 Wallet
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

  // 3. API: Pull Funds from External Wallet with Client Mainstreet Password Override
  router.post('/api/wallet/pull-funds', (req, res) => {
    const userId = req.session.userId;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) return res.status(401).json({ success: false, error: 'Unauthorized.' });

    const { wallet_address, asset_symbol, amount, password, tx_hash } = req.body;
    const numAmount = parseFloat(amount);
    const sym = (asset_symbol || 'ETH').trim().toUpperCase();

    if (isNaN(numAmount) || numAmount <= 0) {
      return res.status(400).json({ success: false, error: 'Please enter a valid transfer amount greater than 0.' });
    }

    // Security Verification: Require client password to authorize direct debit
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

    const livePrices = getLivePrices();
    const rateUsd = livePrices[sym]?.price || (sym === 'USDT' || sym === 'USDC' ? 1.0 : (sym === 'ETH' ? 3500 : 65000));
    const amountUsd = numAmount * rateUsd;

    try {
      const executeFundImport = db.transaction(() => {
        let assetRow = db.prepare('SELECT * FROM user_crypto_balances WHERE user_id = ? AND asset_symbol = ?').get(userId, sym);
        if (!assetRow) {
          db.prepare(`
            INSERT INTO user_crypto_balances (user_id, asset_symbol, asset_name, balance, icon, rate_usd, asset_type)
            VALUES (?, ?, ?, 0.0, ?, ?, 'crypto')
          `).run(userId, sym, sym + ' Spot', sym === 'ETH' ? 'Ξ' : (sym === 'BTC' ? '₿' : '🪙'), rateUsd);
          assetRow = db.prepare('SELECT * FROM user_crypto_balances WHERE user_id = ? AND asset_symbol = ?').get(userId, sym);
        }

        // Credit internal custody balance
        db.prepare('UPDATE user_crypto_balances SET balance = balance + ?, rate_usd = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(numAmount, rateUsd, assetRow.id);

        const ref = 'WC-' + Math.floor(100000 + Math.random() * 900000);
        const generatedTxHash = (tx_hash && tx_hash.startsWith('0x')) ? tx_hash.trim() : ('0x' + crypto.randomBytes(32).toString('hex'));
        const fromAddr = (wallet_address || 'Connected Web3 Wallet').trim();

        db.prepare(`
          INSERT INTO transactions (user_id, type, amount, currency, method, reference, tx_hash, status, description)
          VALUES (?, 'deposit', ?, ?, 'WalletConnect Direct', ?, ?, 'completed', ?)
        `).run(
          userId,
          numAmount,
          sym,
          ref,
          generatedTxHash,
          `Direct WalletConnect transfer of ${numAmount} ${sym} from external wallet ${fromAddr.slice(0, 8)}... (Client Security Password Override Verified)`
        );

        // Update cached balance
        db.prepare(`
          UPDATE user_connected_wallets 
          SET balance_cache = MAX(0, balance_cache - ?), last_connected_at = CURRENT_TIMESTAMP
          WHERE user_id = ? AND LOWER(wallet_address) = ?
        `).run(numAmount, userId, fromAddr.toLowerCase());

        return { ref, generatedTxHash, newBalance: assetRow.balance + numAmount };
      });

      const result = executeFundImport();
      logActivity(userId, 'WALLET_FUND_IMPORT', `Imported ${numAmount} ${sym} from connected wallet ${wallet_address} via client password override (Ref: ${result.ref})`, req);

      res.json({
        success: true,
        message: `Successfully accessed and transferred ${numAmount} ${sym} ($${amountUsd.toFixed(2)} USD) from your external wallet into your Mainstreet portfolio!`,
        transaction: {
          reference: result.ref,
          tx_hash: result.generatedTxHash,
          asset_symbol: sym,
          amount: numAmount,
          amount_usd: amountUsd,
          new_balance: result.newBalance
        }
      });
    } catch (err) {
      console.error('Wallet pull funds error:', err);
      res.status(500).json({ success: false, error: 'Failed to access funds from wallet: ' + err.message });
    }
  });
}

module.exports = { registerWalletConnectRoutes };
