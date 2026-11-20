process.env.DISABLE_CLOUD_VAULT = '1';
const db = require('../src/db');
const { getLivePrices } = require('../src/services/livePriceService');

const expectedStocks = ['APP', 'VST', 'CEG', 'GEV', 'HOOD', 'RKLB', 'HIMS', 'CVNA', 'AXON', 'RDDT', 'VRT', 'SPOT', 'CRWD', 'ASTS', 'IONQ', 'ALAB', 'SMCI', 'SOFI', 'TPL', 'FIX'];
const expectedCryptos = ['HYPE', 'ONDO', 'BGB', 'HBAR', 'XLM', 'ENA', 'VIRTUAL', 'WIF', 'BONK', 'KAS', 'OM', 'SEI', 'INJ', 'PENDLE', 'JUP', 'AERO', 'WLD', 'TRX'];

const existingStocksCheck = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'PLTR', 'AVGO'];
const existingCryptosCheck = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT'];

const allMarkets = db.prepare('SELECT symbol, category, is_tradable FROM market_settings').all();
const mktSet = new Set(allMarkets.map(m => m.symbol));

console.log('Total tradable instruments in market_settings:', allMarkets.length);
console.log('Stocks count:', allMarkets.filter(m => m.category === 'stocks').length);
console.log('Crypto count:', allMarkets.filter(m => m.category === 'crypto').length);

const missingStocks = expectedStocks.filter(s => !mktSet.has(s));
const missingCryptos = expectedCryptos.filter(c => !mktSet.has(c + '/USDT'));
const missingExisting = [...existingStocksCheck, ...existingCryptosCheck].filter(s => !mktSet.has(s));

if (missingStocks.length) throw new Error('Missing new stocks in market_settings: ' + missingStocks.join(', '));
if (missingCryptos.length) throw new Error('Missing new cryptos in market_settings: ' + missingCryptos.join(', '));
if (missingExisting.length) throw new Error('Missing existing markets: ' + missingExisting.join(', '));

const prices = getLivePrices();
const missingPriceStocks = expectedStocks.filter(s => !prices[s] || !prices[s].price);
const missingPriceCryptos = expectedCryptos.filter(c => !prices[c] || !prices[c + '/USDT'] || !prices[c + '/USD']);

if (missingPriceStocks.length) throw new Error('Missing live price entries for stocks: ' + missingPriceStocks.join(', '));
if (missingPriceCryptos.length) throw new Error('Missing live price entries for cryptos: ' + missingPriceCryptos.join(', '));

// Check existing user spot balances include new stocks and new cryptos
const sampleUser = db.prepare('SELECT id FROM users LIMIT 1').get();
if (sampleUser) {
  const userAssets = new Set(db.prepare('SELECT asset_symbol FROM user_crypto_balances WHERE user_id = ?').all(sampleUser.id).map(r => r.asset_symbol));
  const missingUserStocks = expectedStocks.filter(s => !userAssets.has(s));
  const missingUserCryptos = expectedCryptos.filter(c => !userAssets.has(c));
  if (missingUserStocks.length) throw new Error('Missing stocks in user_crypto_balances: ' + missingUserStocks.join(', '));
  if (missingUserCryptos.length) throw new Error('Missing cryptos in user_crypto_balances: ' + missingUserCryptos.join(', '));
  console.log('✓ Existing user spot ledger verified with all', userAssets.size, 'assets');
}

console.log('✓ All 20 new top-performing stocks verified in DB + LivePriceService');
console.log('✓ All 18 new top-performing cryptos verified in DB + LivePriceService (/USDT + /USD)');
console.log('✓ All existing stocks and cryptos intact');
console.log('\n🎉 ALL ASSET UPDATE VERIFICATION CHECKS PASSED!');
process.exit(0);
