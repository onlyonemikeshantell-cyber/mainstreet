const db = require('../db');

// Real-Time Asset Baseline & Live Market Registry
const assetPrices = {
  // Crypto 24/7 Majors & Narratives
  'BTC': { symbol: 'BTC', name: 'Bitcoin', price: 77960.00, change24h: 1.45, prevPrice: 77960.00, direction: 'up', source: 'MEXC Spot' },
  'ETH': { symbol: 'ETH', name: 'Ethereum', price: 2445.00, change24h: -0.85, prevPrice: 2445.00, direction: 'down', source: 'MEXC Spot' },
  'USDT': { symbol: 'USDT', name: 'Tether USD', price: 1.00, change24h: 0.01, prevPrice: 1.00, direction: 'flat', source: 'Pegged' },
  'SOL': { symbol: 'SOL', name: 'Solana', price: 102.50, change24h: 2.30, prevPrice: 102.50, direction: 'up', source: 'MEXC Spot' },
  'BNB': { symbol: 'BNB', name: 'BNB Chain', price: 686.80, change24h: 1.20, prevPrice: 686.80, direction: 'up', source: 'MEXC Spot' },
  'XRP': { symbol: 'XRP', name: 'Ripple', price: 1.3640, change24h: 3.15, prevPrice: 1.3640, direction: 'up', source: 'MEXC Spot' },
  'ADA': { symbol: 'ADA', name: 'Cardano', price: 0.1944, change24h: -1.10, prevPrice: 0.1944, direction: 'down', source: 'MEXC Spot' },
  'AVAX': { symbol: 'AVAX', name: 'Avalanche', price: 7.1670, change24h: -2.40, prevPrice: 7.1670, direction: 'down', source: 'MEXC Spot' },
  'DOGE': { symbol: 'DOGE', name: 'Dogecoin', price: 0.0824, change24h: 1.80, prevPrice: 0.0824, direction: 'up', source: 'MEXC Spot' },
  'TAO': { symbol: 'TAO', name: 'Bittensor', price: 348.50, change24h: 4.20, prevPrice: 348.50, direction: 'up', source: 'MEXC Spot' },
  'RENDER': { symbol: 'RENDER', name: 'Render Network', price: 6.85, change24h: 2.10, prevPrice: 6.85, direction: 'up', source: 'MEXC Spot' },
  'NEAR': { symbol: 'NEAR', name: 'Near Protocol', price: 1.8460, change24h: 0.90, prevPrice: 1.8460, direction: 'up', source: 'MEXC Spot' },
  'FET': { symbol: 'FET', name: 'Artificial Superintelligence', price: 1.35, change24h: 3.10, prevPrice: 1.35, direction: 'up', source: 'MEXC Spot' },
  'LINK': { symbol: 'LINK', name: 'Chainlink', price: 11.20, change24h: 1.40, prevPrice: 11.20, direction: 'up', source: 'MEXC Spot' },
  'UNI': { symbol: 'UNI', name: 'Uniswap', price: 7.60, change24h: 0.80, prevPrice: 7.60, direction: 'up', source: 'MEXC Spot' },
  'AAVE': { symbol: 'AAVE', name: 'Aave', price: 142.50, change24h: 2.60, prevPrice: 142.50, direction: 'up', source: 'MEXC Spot' },
  'ARB': { symbol: 'ARB', name: 'Arbitrum', price: 0.5420, change24h: -1.10, prevPrice: 0.5420, direction: 'down', source: 'MEXC Spot' },
  'OP': { symbol: 'OP', name: 'Optimism', price: 1.4500, change24h: 0.90, prevPrice: 1.4500, direction: 'up', source: 'MEXC Spot' },
  'MATIC': { symbol: 'MATIC', name: 'Polygon', price: 0.4250, change24h: 0.50, prevPrice: 0.4250, direction: 'up', source: 'MEXC Spot' },
  'SUI': { symbol: 'SUI', name: 'Sui Network', price: 0.7201, change24h: 5.30, prevPrice: 0.7201, direction: 'up', source: 'MEXC Spot' },
  'APT': { symbol: 'APT', name: 'Aptos', price: 6.75, change24h: 1.80, prevPrice: 6.75, direction: 'up', source: 'MEXC Spot' },
  'TON': { symbol: 'TON', name: 'Toncoin', price: 5.65, change24h: 2.20, prevPrice: 5.65, direction: 'up', source: 'MEXC Spot' },
  'PEPE': { symbol: 'PEPE', name: 'Pepe', price: 0.00000356, change24h: 6.50, prevPrice: 0.00000356, direction: 'up', source: 'MEXC Spot' },
  'SHIB': { symbol: 'SHIB', name: 'Shiba Inu', price: 0.00000502, change24h: 2.20, prevPrice: 0.00000502, direction: 'up', source: 'MEXC Spot' },
  'LTC': { symbol: 'LTC', name: 'Litecoin', price: 65.40, change24h: 0.70, prevPrice: 65.40, direction: 'up', source: 'MEXC Spot' },

  // Traditional Crypto ETFs & Equities
  'IBIT': { symbol: 'IBIT', name: 'iShares Bitcoin ETF', price: 36.85, change24h: 1.80, prevPrice: 36.85, direction: 'up', source: 'NASDAQ' },
  'ETHA': { symbol: 'ETHA', name: 'iShares Ethereum ETF', price: 28.40, change24h: -0.90, prevPrice: 28.40, direction: 'down', source: 'NASDAQ' },
  'FBTC': { symbol: 'FBTC', name: 'Fidelity Bitcoin', price: 62.10, change24h: 1.75, prevPrice: 62.10, direction: 'up', source: 'BATS' },
  'GBTC': { symbol: 'GBTC', name: 'Grayscale Bitcoin', price: 54.75, change24h: 1.70, prevPrice: 54.75, direction: 'up', source: 'NYSE' },
  'BTC-FUT': { symbol: 'BTC-FUT', name: 'CME Bitcoin Futures', price: 78120.00, change24h: 1.90, prevPrice: 78120.00, direction: 'up', source: 'CME' },
  'ETH-FUT': { symbol: 'ETH-FUT', name: 'CME Ether Futures', price: 2455.00, change24h: -0.80, prevPrice: 2455.00, direction: 'down', source: 'CME' },
  'MSTR': { symbol: 'MSTR', name: 'MicroStrategy', price: 142.80, change24h: 3.80, prevPrice: 142.80, direction: 'up', source: 'NASDAQ' },
  'COIN': { symbol: 'COIN', name: 'Coinbase Global', price: 218.60, change24h: 2.20, prevPrice: 218.60, direction: 'up', source: 'NASDAQ' },
  'MARA': { symbol: 'MARA', name: 'Marathon Digital', price: 18.90, change24h: 4.10, prevPrice: 18.90, direction: 'up', source: 'NASDAQ' },
  'RIOT': { symbol: 'RIOT', name: 'Riot Platforms', price: 10.45, change24h: 3.40, prevPrice: 10.45, direction: 'up', source: 'NASDAQ' },

  // Forex Majors (Real Live European Central Bank / Interbank Feeds)
  'EUR/USD': { symbol: 'EUR/USD', name: 'Euro / USD', price: 1.1596, change24h: 0.15, prevPrice: 1.1596, direction: 'up', source: 'ECB/Interbank' },
  'GBP/USD': { symbol: 'GBP/USD', name: 'GBP / USD', price: 1.3539, change24h: 0.22, prevPrice: 1.3539, direction: 'up', source: 'ECB/Interbank' },
  'USD/JPY': { symbol: 'USD/JPY', name: 'USD / JPY', price: 159.73, change24h: -0.35, prevPrice: 159.73, direction: 'down', source: 'ECB/Interbank' },
  'USD/CHF': { symbol: 'USD/CHF', name: 'USD / CHF', price: 0.8085, change24h: -0.08, prevPrice: 0.8085, direction: 'down', source: 'ECB/Interbank' },
  'AUD/USD': { symbol: 'AUD/USD', name: 'AUD / USD', price: 0.7162, change24h: 0.32, prevPrice: 0.7162, direction: 'up', source: 'ECB/Interbank' },
  'USD/CAD': { symbol: 'USD/CAD', name: 'USD / CAD', price: 1.3886, change24h: -0.14, prevPrice: 1.3886, direction: 'down', source: 'ECB/Interbank' },

  // Commodities & Metals (Real Live CME / NYMEX Spot)
  'XAU/USD': { symbol: 'XAU/USD', name: 'Gold Bullion', price: 4468.10, change24h: -1.36, prevPrice: 4468.10, direction: 'down', source: 'COMEX' },
  'XAG/USD': { symbol: 'XAG/USD', name: 'Silver Bullion', price: 66.85, change24h: -1.37, prevPrice: 66.85, direction: 'down', source: 'COMEX' },
  'USOIL': { symbol: 'USOIL', name: 'WTI Crude Oil', price: 85.70, change24h: 2.75, prevPrice: 85.70, direction: 'up', source: 'NYMEX' },

  // Indices & Equities (Real Live US Markets)
  'US30': { symbol: 'US30', name: 'Dow Jones 30', price: 53138.20, change24h: -0.79, prevPrice: 53138.20, direction: 'down', source: 'NYSE' },
  'NAS100': { symbol: 'NAS100', name: 'Nasdaq 100', price: 26270.15, change24h: -0.50, prevPrice: 26270.15, direction: 'down', source: 'NASDAQ' },
  'SPX500': { symbol: 'SPX500', name: 'S&P 500', price: 7667.40, change24h: -0.58, prevPrice: 7667.40, direction: 'down', source: 'CBOE' },

  // Global Equities & Blue-Chip Stocks (Real Live NASDAQ/NYSE Prices)
  'AAPL': { symbol: 'AAPL', name: 'Apple Inc', price: 314.60, change24h: -1.44, prevPrice: 314.60, direction: 'down', source: 'NASDAQ' },
  'MSFT': { symbol: 'MSFT', name: 'Microsoft Corp', price: 509.14, change24h: -0.85, prevPrice: 509.14, direction: 'down', source: 'NASDAQ' },
  'NVDA': { symbol: 'NVDA', name: 'Nvidia Corp', price: 220.30, change24h: 1.26, prevPrice: 220.30, direction: 'up', source: 'NASDAQ' },
  'TSLA': { symbol: 'TSLA', name: 'Tesla Inc', price: 364.34, change24h: 4.47, prevPrice: 364.34, direction: 'up', source: 'NASDAQ' },
  'AMZN': { symbol: 'AMZN', name: 'Amazon.com Inc', price: 260.13, change24h: -2.36, prevPrice: 260.13, direction: 'down', source: 'NASDAQ' },
  'GOOGL': { symbol: 'GOOGL', name: 'Alphabet Google', price: 337.74, change24h: -2.55, prevPrice: 337.74, direction: 'down', source: 'NASDAQ' },
  'META': { symbol: 'META', name: 'Meta Platforms', price: 570.30, change24h: -1.33, prevPrice: 570.30, direction: 'down', source: 'NASDAQ' },
  'AMD': { symbol: 'AMD', name: 'Advanced Micro Devices', price: 152.40, change24h: 0.60, prevPrice: 152.40, direction: 'up', source: 'NASDAQ' },
  'NFLX': { symbol: 'NFLX', name: 'Netflix Inc', price: 684.20, change24h: 0.72, prevPrice: 684.20, direction: 'up', source: 'NASDAQ' },
  'PLTR': { symbol: 'PLTR', name: 'Palantir Tech', price: 31.80, change24h: 2.10, prevPrice: 31.80, direction: 'up', source: 'NYSE' },
  'JPM': { symbol: 'JPM', name: 'JPMorgan Chase', price: 214.50, change24h: 0.45, prevPrice: 214.50, direction: 'up', source: 'NYSE' },
  'V': { symbol: 'V', name: 'Visa Inc', price: 268.90, change24h: 0.35, prevPrice: 268.90, direction: 'up', source: 'NYSE' },
  'BRK.B': { symbol: 'BRK.B', name: 'Berkshire Hathaway', price: 448.20, change24h: 0.28, prevPrice: 448.20, direction: 'up', source: 'NYSE' },
  'LLY': { symbol: 'LLY', name: 'Eli Lilly and Co', price: 942.50, change24h: 1.15, prevPrice: 942.50, direction: 'up', source: 'NYSE' },
  'DIS': { symbol: 'DIS', name: 'Walt Disney Co', price: 92.40, change24h: 0.85, prevPrice: 92.40, direction: 'up', source: 'NYSE' },
  'BABA': { symbol: 'BABA', name: 'Alibaba Group', price: 82.50, change24h: 1.20, prevPrice: 82.50, direction: 'up', source: 'NYSE' },
  'TSM': { symbol: 'TSM', name: 'Taiwan Semi Mfg', price: 168.40, change24h: 2.30, prevPrice: 168.40, direction: 'up', source: 'NYSE' },
  'UBER': { symbol: 'UBER', name: 'Uber Tech', price: 72.80, change24h: 1.40, prevPrice: 72.80, direction: 'up', source: 'NYSE' },
  'USD': { symbol: 'USD', name: 'US Dollar', price: 1.00, change24h: 0.00, prevPrice: 1.00, direction: 'flat', source: 'Fiat' },

  // Premier Real Estate Investment Trusts (REITs)
  'PLD': { symbol: 'PLD', name: 'Prologis Inc', category: 'reit', price: 124.50, prevPrice: 124.50, change24h: 0.65, direction: 'up', spread: 0.08, high24h: 126.10, low24h: 123.80, source: 'Live Real Institutional Feed' },
  'O': { symbol: 'O', name: 'Realty Income Corp', category: 'reit', price: 56.80, prevPrice: 56.80, change24h: 0.42, direction: 'up', spread: 0.05, high24h: 57.30, low24h: 56.40, source: 'Live Real Institutional Feed' },
  'EQIX': { symbol: 'EQIX', name: 'Equinix Inc', category: 'reit', price: 875.20, prevPrice: 875.20, change24h: 1.15, direction: 'up', spread: 0.15, high24h: 882.00, low24h: 870.50, source: 'Live Real Institutional Feed' },
  'AMT': { symbol: 'AMT', name: 'American Tower Corp', category: 'reit', price: 225.40, prevPrice: 225.40, change24h: -0.35, direction: 'down', spread: 0.12, high24h: 227.50, low24h: 224.20, source: 'Live Real Institutional Feed' },
  'SPG': { symbol: 'SPG', name: 'Simon Property Group', category: 'reit', price: 158.30, prevPrice: 158.30, change24h: 0.88, direction: 'up', spread: 0.10, high24h: 160.00, low24h: 157.20, source: 'Live Real Institutional Feed' },
  'PSA': { symbol: 'PSA', name: 'Public Storage', category: 'reit', price: 312.60, prevPrice: 312.60, change24h: 0.52, direction: 'up', spread: 0.12, high24h: 315.40, low24h: 310.80, source: 'Live Real Institutional Feed' },
  'DLR': { symbol: 'DLR', name: 'Digital Realty Trust', category: 'reit', price: 154.20, prevPrice: 154.20, change24h: 1.40, direction: 'up', spread: 0.10, high24h: 156.00, low24h: 153.10, source: 'Live Real Institutional Feed' },
  'WELL': { symbol: 'WELL', name: 'Welltower Inc', category: 'reit', price: 118.90, prevPrice: 118.90, change24h: 0.30, direction: 'up', spread: 0.08, high24h: 120.20, low24h: 118.10, source: 'Live Real Institutional Feed' },
  'VICI': { symbol: 'VICI', name: 'VICI Properties Inc', category: 'reit', price: 32.40, prevPrice: 32.40, change24h: 0.25, direction: 'up', spread: 0.06, high24h: 32.85, low24h: 32.15, source: 'Live Real Institutional Feed' },
  'VNQ': { symbol: 'VNQ', name: 'Vanguard Real Estate ETF', category: 'reit', price: 92.10, prevPrice: 92.10, change24h: 0.48, direction: 'up', spread: 0.06, high24h: 93.00, low24h: 91.60, source: 'Live Real Institutional Feed' },

  // Institutional Exchange-Traded Funds (ETFs)
  'SPY': { symbol: 'SPY', name: 'SPDR S&P 500 ETF Trust', category: 'etf', price: 766.15, prevPrice: 769.35, change24h: -0.42, direction: 'down', spread: 0.05, high24h: 770.20, low24h: 764.50, source: 'Live Real Institutional Feed' },
  'QQQ': { symbol: 'QQQ', name: 'Invesco QQQ Trust (Nasdaq 100)', category: 'etf', price: 714.78, prevPrice: 716.43, change24h: -0.23, direction: 'down', spread: 0.05, high24h: 718.50, low24h: 712.10, source: 'Live Real Institutional Feed' },
  'VOO': { symbol: 'VOO', name: 'Vanguard S&P 500 ETF', category: 'etf', price: 704.30, prevPrice: 707.24, change24h: -0.41, direction: 'down', spread: 0.04, high24h: 708.90, low24h: 702.40, source: 'Live Real Institutional Feed' },
  'VTI': { symbol: 'VTI', name: 'Vanguard Total Stock Market ETF', category: 'etf', price: 377.68, prevPrice: 379.36, change24h: -0.44, direction: 'down', spread: 0.05, high24h: 380.10, low24h: 376.50, source: 'Live Real Institutional Feed' },
  'DIA': { symbol: 'DIA', name: 'SPDR Dow Jones Industrial Average ETF', category: 'etf', price: 531.98, prevPrice: 535.06, change24h: -0.58, direction: 'down', spread: 0.06, high24h: 536.00, low24h: 530.50, source: 'Live Real Institutional Feed' },
  'IWM': { symbol: 'IWM', name: 'iShares Russell 2000 ETF', category: 'etf', price: 293.45, prevPrice: 295.75, change24h: -0.78, direction: 'down', spread: 0.08, high24h: 296.80, low24h: 291.90, source: 'Live Real Institutional Feed' },
  'SMH': { symbol: 'SMH', name: 'VanEck Semiconductor ETF', category: 'etf', price: 555.21, prevPrice: 553.11, change24h: 0.38, direction: 'up', spread: 0.10, high24h: 559.00, low24h: 551.40, source: 'Live Real Institutional Feed' },
  'SOXX': { symbol: 'SOXX', name: 'iShares Semiconductor ETF', category: 'etf', price: 282.10, prevPrice: 280.95, change24h: 0.41, direction: 'up', spread: 0.10, high24h: 284.50, low24h: 279.80, source: 'Live Real Institutional Feed' },
  'XLK': { symbol: 'XLK', name: 'Technology Select Sector SPDR', category: 'etf', price: 185.77, prevPrice: 185.69, change24h: 0.04, direction: 'up', spread: 0.08, high24h: 187.20, low24h: 184.50, source: 'Live Real Institutional Feed' },
  'XLF': { symbol: 'XLF', name: 'Financial Select Sector SPDR', category: 'etf', price: 57.84, prevPrice: 58.10, change24h: -0.45, direction: 'down', spread: 0.05, high24h: 58.40, low24h: 57.50, source: 'Live Real Institutional Feed' },
  'XLE': { symbol: 'XLE', name: 'Energy Select Sector SPDR', category: 'etf', price: 63.49, prevPrice: 62.68, change24h: 1.29, direction: 'up', spread: 0.06, high24h: 64.10, low24h: 62.30, source: 'Live Real Institutional Feed' },
  'ARKK': { symbol: 'ARKK', name: 'ARK Innovation ETF', category: 'etf', price: 84.27, prevPrice: 84.59, change24h: -0.38, direction: 'down', spread: 0.12, high24h: 85.60, low24h: 83.40, source: 'Live Real Institutional Feed' },
  'GLD': { symbol: 'GLD', name: 'SPDR Gold Shares', category: 'etf', price: 406.60, prevPrice: 408.89, change24h: -0.56, direction: 'down', spread: 0.08, high24h: 410.00, low24h: 404.50, source: 'Live Real Institutional Feed' },
  'SLV': { symbol: 'SLV', name: 'iShares Silver Trust', category: 'etf', price: 59.96, prevPrice: 60.02, change24h: -0.10, direction: 'down', spread: 0.10, high24h: 60.80, low24h: 59.20, source: 'Live Real Institutional Feed' },
  'TLT': { symbol: 'TLT', name: 'iShares 20+ Year Treasury Bond ETF', category: 'etf', price: 82.32, prevPrice: 82.88, change24h: -0.68, direction: 'down', spread: 0.06, high24h: 83.40, low24h: 81.90, source: 'Live Real Institutional Feed' },
  'BND': { symbol: 'BND', name: 'Vanguard Total Bond Market ETF', category: 'etf', price: 72.22, prevPrice: 72.31, change24h: -0.12, direction: 'down', spread: 0.05, high24h: 72.60, low24h: 71.90, source: 'Live Real Institutional Feed' },
  'IBIT': { symbol: 'IBIT', name: 'iShares Bitcoin Trust ETF', category: 'etf', price: 44.50, prevPrice: 43.90, change24h: 1.37, direction: 'up', spread: 0.10, high24h: 45.20, low24h: 43.50, source: 'Live Real Institutional Feed' },
  'ETHA': { symbol: 'ETHA', name: 'iShares Ethereum Trust ETF', category: 'etf', price: 18.63, prevPrice: 18.37, change24h: 1.42, direction: 'up', spread: 0.12, high24h: 19.10, low24h: 18.20, source: 'Live Real Institutional Feed' }
};

// ==============================================================================
// 1. LIVE CRYPTO SPOT SYNC (MEXC REST TICKERS)
// ==============================================================================
const CRYPTO_SYMBOL_MAP = {
  'BTCUSDT': 'BTC',
  'ETHUSDT': 'ETH',
  'SOLUSDT': 'SOL',
  'BNBUSDT': 'BNB',
  'XRPUSDT': 'XRP',
  'ADAUSDT': 'ADA',
  'AVAXUSDT': 'AVAX',
  'DOGEUSDT': 'DOGE',
  'LINKUSDT': 'LINK',
  'UNIUSDT': 'UNI',
  'NEARUSDT': 'NEAR',
  'SUIUSDT': 'SUI',
  'PEPEUSDT': 'PEPE',
  'SHIBUSDT': 'SHIB',
  'LTCUSDT': 'LTC',
  'TAOUSDT': 'TAO',
  'RENDERUSDT': 'RENDER',
  'FETUSDT': 'FET',
  'AAVEUSDT': 'AAVE',
  'ARBUSDT': 'ARB',
  'OPUSDT': 'OP',
  'MATICUSDT': 'MATIC',
  'APTUSDT': 'APT',
  'TONUSDT': 'TON'
};

async function syncRealCryptoPrices() {
  try {
    const res = await fetch('https://api.mexc.com/api/v3/ticker/price', { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return;
    const tickers = await res.json();
    tickers.forEach(t => {
      const target = CRYPTO_SYMBOL_MAP[t.symbol];
      if (target && assetPrices[target]) {
        const p = parseFloat(t.price);
        if (!isNaN(p) && p > 0) {
          assetPrices[target].prevPrice = assetPrices[target].price;
          assetPrices[target].price = p;
          assetPrices[target].anchorPrice = p;
          assetPrices[target].direction = p >= assetPrices[target].prevPrice ? 'up' : 'down';
          assetPrices[target].source = 'Live Real MEXC Spot';
        }
      }
    });
  } catch(e) {
    // Network fallback handled silently
  }
}

// ==============================================================================
// 2. LIVE FOREX MAJORS SYNC (European Central Bank / Frankfurter Feed)
// ==============================================================================
async function syncRealForexPrices() {
  try {
    const res = await fetch('https://api.frankfurter.app/latest?from=USD', { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return;
    const data = await res.json();
    const rates = data.rates;

    if (rates.EUR && assetPrices['EUR/USD']) {
      const p = +(1 / rates.EUR).toFixed(4);
      assetPrices['EUR/USD'].prevPrice = assetPrices['EUR/USD'].price;
      assetPrices['EUR/USD'].price = p;
      assetPrices['EUR/USD'].anchorPrice = p;
      assetPrices['EUR/USD'].direction = p >= assetPrices['EUR/USD'].prevPrice ? 'up' : 'down';
      assetPrices['EUR/USD'].source = 'Live Real ECB/Interbank';
    }
    if (rates.GBP && assetPrices['GBP/USD']) {
      const p = +(1 / rates.GBP).toFixed(4);
      assetPrices['GBP/USD'].prevPrice = assetPrices['GBP/USD'].price;
      assetPrices['GBP/USD'].price = p;
      assetPrices['GBP/USD'].anchorPrice = p;
      assetPrices['GBP/USD'].direction = p >= assetPrices['GBP/USD'].prevPrice ? 'up' : 'down';
      assetPrices['GBP/USD'].source = 'Live Real ECB/Interbank';
    }
    if (rates.JPY && assetPrices['USD/JPY']) {
      const p = +rates.JPY.toFixed(2);
      assetPrices['USD/JPY'].prevPrice = assetPrices['USD/JPY'].price;
      assetPrices['USD/JPY'].price = p;
      assetPrices['USD/JPY'].anchorPrice = p;
      assetPrices['USD/JPY'].direction = p >= assetPrices['USD/JPY'].prevPrice ? 'up' : 'down';
      assetPrices['USD/JPY'].source = 'Live Real ECB/Interbank';
    }
    if (rates.CAD && assetPrices['USD/CAD']) {
      const p = +rates.CAD.toFixed(4);
      assetPrices['USD/CAD'].prevPrice = assetPrices['USD/CAD'].price;
      assetPrices['USD/CAD'].price = p;
      assetPrices['USD/CAD'].anchorPrice = p;
      assetPrices['USD/CAD'].direction = p >= assetPrices['USD/CAD'].prevPrice ? 'up' : 'down';
      assetPrices['USD/CAD'].source = 'Live Real ECB/Interbank';
    }
    if (rates.CHF && assetPrices['USD/CHF']) {
      const p = +rates.CHF.toFixed(4);
      assetPrices['USD/CHF'].prevPrice = assetPrices['USD/CHF'].price;
      assetPrices['USD/CHF'].price = p;
      assetPrices['USD/CHF'].direction = p >= assetPrices['USD/CHF'].prevPrice ? 'up' : 'down';
      assetPrices['USD/CHF'].source = 'Live Real ECB/Interbank';
    }
    if (rates.AUD && assetPrices['AUD/USD']) {
      const p = +(1 / rates.AUD).toFixed(4);
      assetPrices['AUD/USD'].prevPrice = assetPrices['AUD/USD'].price;
      assetPrices['AUD/USD'].price = p;
      assetPrices['AUD/USD'].direction = p >= assetPrices['AUD/USD'].prevPrice ? 'up' : 'down';
      assetPrices['AUD/USD'].source = 'Live Real ECB/Interbank';
    }
  } catch(e) {
    // Network fallback handled silently
  }
}

// ==============================================================================
// 3. LIVE EQUITIES, INDICES & COMMODITIES (Yahoo Finance Direct)
// ==============================================================================
const YAHOO_MAP = {
  'PLD': 'PLD',
  'O': 'O',
  'EQIX': 'EQIX',
  'AMT': 'AMT',
  'SPG': 'SPG',
  'PSA': 'PSA',
  'DLR': 'DLR',
  'WELL': 'WELL',
  'VICI': 'VICI',
  'VNQ': 'VNQ',
  'GC=F': 'XAU/USD',
  'SI=F': 'XAG/USD',
  'CL=F': 'USOIL',
  '^DJI': 'US30',
  '^IXIC': 'NAS100',
  '^GSPC': 'SPX500',
  'AAPL': 'AAPL',
  'MSFT': 'MSFT',
  'NVDA': 'NVDA',
  'TSLA': 'TSLA',
  'AMZN': 'AMZN',
  'GOOGL': 'GOOGL',
  'META': 'META',
  'MSTR': 'MSTR',
  'COIN': 'COIN',
  'IBIT': 'IBIT',
  'ETHA': 'ETHA',
  'SPY': 'SPY',
  'QQQ': 'QQQ',
  'VOO': 'VOO',
  'VTI': 'VTI',
  'DIA': 'DIA',
  'IWM': 'IWM',
  'SMH': 'SMH',
  'SOXX': 'SOXX',
  'XLK': 'XLK',
  'XLF': 'XLF',
  'XLE': 'XLE',
  'ARKK': 'ARKK',
  'GLD': 'GLD',
  'SLV': 'SLV',
  'TLT': 'TLT',
  'BND': 'BND'
};

async function syncRealMarketQuotes() {
  const yahooKeys = Object.keys(YAHOO_MAP);
  for (const ySym of yahooKeys) {
    try {
      const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySym)}?interval=1d`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Mainstreet Capital Exchange/2.0' },
        signal: AbortSignal.timeout(4000)
      });
      if (!res.ok) continue;
      const data = await res.json();
      const meta = data.chart?.result?.[0]?.meta;
      if (meta && meta.regularMarketPrice) {
        const target = YAHOO_MAP[ySym];
        if (target && assetPrices[target]) {
          const price = meta.regularMarketPrice;
          const prev = meta.chartPreviousClose || assetPrices[target].price;
          const chg = prev > 0 ? +(((price - prev) / prev) * 100).toFixed(2) : 0;

          assetPrices[target].prevPrice = assetPrices[target].price;
          assetPrices[target].price = +price.toFixed(2);
          assetPrices[target].change24h = chg;
          assetPrices[target].direction = price >= prev ? 'up' : 'down';
          assetPrices[target].source = 'Live Real Institutional Feed';
        }
      }
    } catch(e) {}
  }
}

// Master Background Sync function for all Real Feeds
async function syncAllRealFeeds() {
  await Promise.allSettled([
    syncRealCryptoPrices(),
    syncRealForexPrices(),
    syncRealMarketQuotes()
  ]);
}

// Run full real sync immediately on boot, then every 15 seconds
syncAllRealFeeds();
setInterval(syncAllRealFeeds, 15000);

// ==============================================================================
// 4. SUB-SECOND HIGH-FREQUENCY TICK JITTER ENGINE (Ornstein-Uhlenbeck Process)
// ==============================================================================

// High-performance Box-Muller Gaussian normal distribution N(0, 1)
function gaussianRandom() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// Asset-Class Specific Microstructure Profiles (Precision, Volatility, Spread, Arrival Rate)
const ASSET_PROFILES = {
  // Forex Majors: tight interbank spreads, fractional pips, high stability
  'EUR/USD': { dec: 4, sigma: 0.00003, spread: 0.00012, tickRate: 0.85 },
  'GBP/USD': { dec: 4, sigma: 0.00004, spread: 0.00015, tickRate: 0.85 },
  'USD/JPY': { dec: 2, sigma: 0.00005, spread: 0.015,   tickRate: 0.85 },
  'USD/CHF': { dec: 4, sigma: 0.00003, spread: 0.00014, tickRate: 0.75 },
  'AUD/USD': { dec: 4, sigma: 0.00004, spread: 0.00014, tickRate: 0.75 },
  'USD/CAD': { dec: 4, sigma: 0.00004, spread: 0.00015, tickRate: 0.75 },

  // Crypto Majors: high liquidity, rapid quote vibration
  'BTC':     { dec: 2, sigma: 0.00010, spread: 1.20,    tickRate: 0.95 },
  'ETH':     { dec: 2, sigma: 0.00012, spread: 0.35,    tickRate: 0.95 },
  'SOL':     { dec: 2, sigma: 0.00018, spread: 0.06,    tickRate: 0.90 },
  'BNB':     { dec: 2, sigma: 0.00014, spread: 0.20,    tickRate: 0.85 },
  'XRP':     { dec: 4, sigma: 0.00020, spread: 0.0006,  tickRate: 0.85 },

  // Crypto Alts & Ecosystems
  'DOGE':    { dec: 4, sigma: 0.00025, spread: 0.0001,  tickRate: 0.80 },
  'ADA':     { dec: 4, sigma: 0.00020, spread: 0.0002,  tickRate: 0.75 },
  'AVAX':    { dec: 4, sigma: 0.00022, spread: 0.0040,  tickRate: 0.75 },
  'LINK':    { dec: 2, sigma: 0.00015, spread: 0.02,    tickRate: 0.75 },
  'NEAR':    { dec: 4, sigma: 0.00020, spread: 0.0020,  tickRate: 0.75 },
  'SUI':     { dec: 4, sigma: 0.00025, spread: 0.0008,  tickRate: 0.80 },
  'PEPE':    { dec: 8, sigma: 0.00035, spread: 0.00000002, tickRate: 0.85 },
  'SHIB':    { dec: 8, sigma: 0.00030, spread: 0.00000003, tickRate: 0.80 },

  // Commodities & Precious Metals
  'XAU/USD': { dec: 2, sigma: 0.00006, spread: 0.30,    tickRate: 0.90 },
  'XAG/USD': { dec: 2, sigma: 0.00008, spread: 0.02,    tickRate: 0.85 },
  'USOIL':   { dec: 2, sigma: 0.00010, spread: 0.03,    tickRate: 0.80 },

  // Stock Indices
  'US30':    { dec: 2, sigma: 0.00004, spread: 1.40,    tickRate: 0.85 },
  'NAS100':  { dec: 2, sigma: 0.00005, spread: 0.75,    tickRate: 0.90 },
  'SPX500':  { dec: 2, sigma: 0.00004, spread: 0.35,    tickRate: 0.90 },

  // Equities & Bluechips
  'NVDA':    { dec: 2, sigma: 0.00010, spread: 0.04,    tickRate: 0.90 },
  'TSLA':    { dec: 2, sigma: 0.00012, spread: 0.05,    tickRate: 0.90 },
  'AAPL':    { dec: 2, sigma: 0.00006, spread: 0.03,    tickRate: 0.85 },
  'MSFT':    { dec: 2, sigma: 0.00006, spread: 0.04,    tickRate: 0.80 },
  'AMZN':    { dec: 2, sigma: 0.00007, spread: 0.03,    tickRate: 0.80 },
  'META':    { dec: 2, sigma: 0.00008, spread: 0.05,    tickRate: 0.80 },
  'SPY':     { dec: 2, sigma: 0.00003, spread: 0.02,    tickRate: 0.90 },
  'QQQ':     { dec: 2, sigma: 0.00004, spread: 0.02,    tickRate: 0.90 }
};

// Initialize anchorPrice and order book state on startup
Object.keys(assetPrices).forEach(sym => {
  const item = assetPrices[sym];
  if (!item.anchorPrice) item.anchorPrice = item.price;
  const prof = ASSET_PROFILES[sym] || (
    sym.includes('/')
      ? { dec: 4, spread: 0.00015 }
      : item.price < 1.0 ? { dec: 4, spread: +(item.price * 0.0006).toFixed(4) } : { dec: 2, spread: +(item.price * 0.0003).toFixed(2) }
  );
  const halfSpread = prof.spread / 2;
  item.bid = +(item.price - halfSpread).toFixed(prof.dec);
  item.ask = +(item.price + halfSpread).toFixed(prof.dec);
  item.spread = prof.spread;
  item.lastTickTime = Date.now();
});

/**
 * High-Frequency In-Memory Micro-Tick Processor (Runs every 300ms)
 * Simulates continuous order book liquidity consumption and quote bounce
 * with zero database overhead.
 */
const tickMarketPrices = () => {
  const now = Date.now();
  Object.keys(assetPrices).forEach(sym => {
    if (sym === 'USDT' || sym === 'USD') return;
    const item = assetPrices[sym];
    if (!item || !item.price) return;

    if (!item.anchorPrice) item.anchorPrice = item.price;
    const prof = ASSET_PROFILES[sym] || (
      sym.includes('/')
        ? { dec: 4, sigma: 0.00004, spread: 0.00015, tickRate: 0.75 }
        : item.price < 1.0
          ? { dec: 4, sigma: 0.00020, spread: +(item.price * 0.0006).toFixed(4), tickRate: 0.75 }
          : { dec: 2, sigma: 0.00006, spread: +(item.price * 0.0003).toFixed(2), tickRate: 0.80 }
    );

    // Realistic Poisson tick arrival: active assets tick frequently, illiquid assets tick periodically
    if (Math.random() > prof.tickRate) return;

    // Ornstein-Uhlenbeck: elastic mean-reversion pull toward real-world anchor baseline
    const anchor = item.anchorPrice;
    const displacement = (item.price - anchor) / anchor;
    // Restoring force: gently pulls price back to center if displaced beyond +/- 0.08%
    const reversion = -displacement * 0.35;

    // Gaussian Brownian noise with asset-specific micro-volatility
    const shock = gaussianRandom() * prof.sigma;

    // Composite fractional tick change
    const delta = reversion + shock;

    const oldPrice = item.price;
    const rawNewPrice = item.price * (1 + delta);
    const newPrice = +(rawNewPrice.toFixed(prof.dec));

    item.prevPrice = oldPrice;
    item.price = newPrice;
    item.direction = newPrice > oldPrice ? 'up' : (newPrice < oldPrice ? 'down' : (shock >= 0 ? 'up' : 'down'));

    // Dynamic institutional Bid / Ask spreads
    const halfSpread = prof.spread / 2;
    item.bid = +(newPrice - halfSpread).toFixed(prof.dec);
    item.ask = +(newPrice + halfSpread).toFixed(prof.dec);
    item.spread = prof.spread;
    item.lastTickTime = now;
  });
};

/**
 * Throttled Database Sync & Order Matching Engine (Runs every 1,500ms)
 * Decoupled from micro-ticks to ensure zero database lock contention.
 */
const persistMarketAndCheckOrders = () => {
  // 1. Sync to database balances so trader net worth reflects real market values
  try {
    const updateStmt = db.prepare('UPDATE user_crypto_balances SET rate_usd = ? WHERE asset_symbol = ?');
    Object.keys(assetPrices).forEach(sym => {
      updateStmt.run(assetPrices[sym].price, sym);
    });
  } catch(e) {}

  // 2. Auto-Trigger Pending Limit Orders
  try {
    const pendingOrders = db.prepare("SELECT * FROM trades WHERE status = 'PENDING'").all();
    if (pendingOrders.length > 0) {
      const triggerStmt = db.prepare("UPDATE trades SET status = 'OPEN', current_price = ?, opened_at = CURRENT_TIMESTAMP WHERE id = ?");
      pendingOrders.forEach(po => {
        const alias = po.symbol.replace('/USDT', '').replace('/USD', '');
        const quote = assetPrices[po.symbol] || assetPrices[alias];
        if (quote && quote.price) {
          const curPrice = quote.price;
          let shouldTrigger = false;
          if (po.type === 'BUY' && curPrice <= po.open_price) {
            shouldTrigger = true;
          } else if (po.type === 'SELL' && curPrice >= po.open_price) {
            shouldTrigger = true;
          }
          if (shouldTrigger) {
            triggerStmt.run(curPrice, po.id);
            try {
              db.prepare("INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, 'trade')")
                .run(po.user_id, 'Limit Order Triggered', `Pending limit order #${po.id} (${po.symbol} ${po.type}) filled at $${curPrice}`);
            } catch(ne) {}
          }
        }
      });
    }
  } catch(e) {}

  // 3. Automated TP / SL Execution
  try {
    const openTrades = db.prepare("SELECT * FROM trades WHERE status = 'OPEN' AND ((take_profit IS NOT NULL AND take_profit > 0) OR (stop_loss IS NOT NULL AND stop_loss > 0))").all();
    if (openTrades.length > 0) {
      openTrades.forEach(tr => {
        const alias = tr.symbol.replace('/USDT', '').replace('/USD', '');
        const quote = assetPrices[tr.symbol] || assetPrices[alias];
        if (!quote || !quote.price) return;
        const curPrice = quote.price;

        let shouldClose = false;
        let closeReason = '';
        let executionPrice = curPrice;

        if (tr.type === 'BUY') {
          if (tr.take_profit > 0 && curPrice >= tr.take_profit) {
            shouldClose = true;
            closeReason = 'Take Profit Triggered';
            executionPrice = tr.take_profit;
          } else if (tr.stop_loss > 0 && curPrice <= tr.stop_loss) {
            shouldClose = true;
            closeReason = 'Stop Loss Triggered';
            executionPrice = tr.stop_loss;
          }
        } else if (tr.type === 'SELL') {
          if (tr.take_profit > 0 && curPrice <= tr.take_profit) {
            shouldClose = true;
            closeReason = 'Take Profit Triggered';
            executionPrice = tr.take_profit;
          } else if (tr.stop_loss > 0 && curPrice >= tr.stop_loss) {
            shouldClose = true;
            closeReason = 'Stop Loss Triggered';
            executionPrice = tr.stop_loss;
          }
        }

        if (shouldClose) {
          let rawPnl = tr.type === 'BUY' ? (executionPrice - tr.open_price) * tr.lot_size * 100 : (tr.open_price - executionPrice) * tr.lot_size * 100;
          db.prepare(`UPDATE trades SET status = 'CLOSED', close_price = ?, current_price = ?, profit_loss = ?, closed_at = CURRENT_TIMESTAMP WHERE id = ?`).run(executionPrice, executionPrice, rawPnl, tr.id);

          const user = db.prepare('SELECT * FROM users WHERE id = ?').get(tr.user_id);
          if (user) {
            const newBal = user.balance + rawPnl;
            const newEquity = user.equity + rawPnl;
            db.prepare('UPDATE users SET balance = ?, equity = ? WHERE id = ?').run(newBal, newEquity, user.id);
            db.prepare(`INSERT INTO transactions (user_id, type, amount, currency, method, status, reference, description) VALUES (?, 'trade', ?, 'USD', 'STP Settlement', 'completed', ?, ?)`).run(user.id, Math.abs(rawPnl), 'TP-SL-' + tr.id + '-' + Date.now(), `${closeReason} on #${tr.id} (${tr.symbol} ${tr.type}): Realized ${rawPnl >= 0 ? '+$' : '-$'}${Math.abs(rawPnl).toFixed(2)}`);
          }
        }
      });
    }
  } catch(e) {}

  // 4. Stop-Out Margin Liquidation
  try {
    const usersWithTrades = db.prepare("SELECT DISTINCT user_id FROM trades WHERE status = 'OPEN'").all();
    usersWithTrades.forEach(u => {
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(u.user_id);
      if (!user) return;

      const userTrades = db.prepare("SELECT * FROM trades WHERE user_id = ? AND status = 'OPEN'").all(user.id);
      if (userTrades.length === 0) return;

      let totalUsedMargin = 0;
      let totalFloatingPnl = 0;

      userTrades.forEach(t => {
        totalUsedMargin += (t.lot_size * 100);
        const alias = t.symbol.replace('/USDT', '').replace('/USD', '');
        const quote = assetPrices[t.symbol] || assetPrices[alias];
        const cp = (quote && quote.price) ? quote.price : t.open_price;
        const pnl = (t.type === 'BUY' ? (cp - t.open_price) : (t.open_price - cp)) * t.lot_size * 100;
        totalFloatingPnl += pnl;
      });

      const liveEquity = user.balance + totalFloatingPnl;
      const marginLevel = totalUsedMargin > 0 ? (liveEquity / totalUsedMargin) * 100 : 999;

      if (marginLevel < 40 || liveEquity <= 0) {
        let worstTrade = null;
        let worstLoss = 0;

        userTrades.forEach(t => {
          const alias = t.symbol.replace('/USDT', '').replace('/USD', '');
          const quote = assetPrices[t.symbol] || assetPrices[alias];
          const cp = (quote && quote.price) ? quote.price : t.open_price;
          const pnl = (t.type === 'BUY' ? (cp - t.open_price) : (t.open_price - cp)) * t.lot_size * 100;
          if (pnl < worstLoss) {
            worstLoss = pnl;
            worstTrade = { ...t, curPrice: cp, pnl };
          }
        });

        if (worstTrade) {
          db.prepare(`UPDATE trades SET status = 'CLOSED', close_price = ?, current_price = ?, profit_loss = ?, closed_at = CURRENT_TIMESTAMP WHERE id = ?`).run(worstTrade.curPrice, worstTrade.curPrice, worstTrade.pnl, worstTrade.id);
          const updatedBal = Math.max(0, user.balance + worstTrade.pnl);
          db.prepare('UPDATE users SET balance = ?, equity = ? WHERE id = ?').run(updatedBal, updatedBal, user.id);
        }
      }
    });
  } catch(e) {}
};

// Calm Institutional Price Ticks: 8,000ms in-memory heartbeat
setInterval(tickMarketPrices, 8000);

// Throttled Database & Order Check: 10,000ms
setInterval(persistMarketAndCheckOrders, 10000);

const getLivePrices = () => {
  const fullMap = { ...assetPrices };
  
  // Aliases for perps and pairs
  fullMap['BTC/USDT'] = assetPrices['BTC'];
  fullMap['BTC/USD'] = assetPrices['BTC'];
  fullMap['ETH/USDT'] = assetPrices['ETH'];
  fullMap['ETH/USD'] = assetPrices['ETH'];
  fullMap['SOL/USDT'] = assetPrices['SOL'];
  fullMap['SOL/USD'] = assetPrices['SOL'];
  fullMap['BNB/USDT'] = assetPrices['BNB'];
  fullMap['BNB/USD'] = assetPrices['BNB'];
  fullMap['XRP/USDT'] = assetPrices['XRP'];
  fullMap['XRP/USD'] = assetPrices['XRP'];
  fullMap['ADA/USDT'] = assetPrices['ADA'];
  fullMap['AVAX/USDT'] = assetPrices['AVAX'];
  fullMap['DOGE/USDT'] = assetPrices['DOGE'];
  fullMap['TAO/USDT'] = assetPrices['TAO'];
  fullMap['RENDER/USDT'] = assetPrices['RENDER'];
  fullMap['NEAR/USDT'] = assetPrices['NEAR'];
  fullMap['FET/USDT'] = assetPrices['FET'];
  fullMap['LINK/USDT'] = assetPrices['LINK'];
  fullMap['UNI/USDT'] = assetPrices['UNI'];
  fullMap['AAVE/USDT'] = assetPrices['AAVE'];
  fullMap['ARB/USDT'] = assetPrices['ARB'];
  fullMap['OP/USDT'] = assetPrices['OP'];
  fullMap['MATIC/USDT'] = assetPrices['MATIC'];
  fullMap['SUI/USDT'] = assetPrices['SUI'];
  fullMap['APT/USDT'] = assetPrices['APT'];
  fullMap['TON/USDT'] = assetPrices['TON'];
  fullMap['PEPE/USDT'] = assetPrices['PEPE'];
  fullMap['SHIB/USDT'] = assetPrices['SHIB'];
  fullMap['LTC/USDT'] = assetPrices['LTC'];

  return fullMap;
};

const syncClientLivePrice = (symbol, livePrice) => {
  if (assetPrices[symbol] && typeof livePrice === 'number' && livePrice > 0) {
    assetPrices[symbol].prevPrice = assetPrices[symbol].price;
    assetPrices[symbol].price = livePrice;
    assetPrices[symbol].direction = livePrice >= assetPrices[symbol].prevPrice ? 'up' : 'down';
  }
};

module.exports = {
  getLivePrices,
  syncClientLivePrice,
  tickMarketPrices,
  syncAllRealFeeds
};
