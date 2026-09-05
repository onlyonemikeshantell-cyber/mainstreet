// Stock Thematic Baskets & Dividend Yield Configurations

const STOCK_BASKETS = {
  ai_titans: {
    id: 'ai_titans',
    name: 'AI & Semiconductor Titans',
    tagline: 'Leading infrastructure, generative compute & algorithmic enterprise AI',
    icon: '🤖',
    badgeColor: 'emerald',
    annualizedReturn: 38.4,
    dividendYield: 1.2,
    riskLevel: 'Moderate High',
    minInvestment: 50,
    holdings: [
      { symbol: 'NVDA', name: 'Nvidia Corp', weight: 0.30 },
      { symbol: 'MSFT', name: 'Microsoft Corp', weight: 0.25 },
      { symbol: 'AMD', name: 'Advanced Micro Devices', weight: 0.20 },
      { symbol: 'TSM', name: 'Taiwan Semi Mfg', weight: 0.15 },
      { symbol: 'PLTR', name: 'Palantir Tech', weight: 0.10 }
    ]
  },
  mag_7: {
    id: 'mag_7',
    name: 'Magnificent 7 Mega-Cap Index',
    tagline: 'The dominant tech titans driving global digital commerce and cloud',
    icon: '👑',
    badgeColor: 'sky',
    annualizedReturn: 31.2,
    dividendYield: 1.5,
    riskLevel: 'Moderate',
    minInvestment: 50,
    holdings: [
      { symbol: 'AAPL', name: 'Apple Inc', weight: 0.20 },
      { symbol: 'MSFT', name: 'Microsoft Corp', weight: 0.20 },
      { symbol: 'NVDA', name: 'Nvidia Corp', weight: 0.18 },
      { symbol: 'AMZN', name: 'Amazon.com Inc', weight: 0.15 },
      { symbol: 'GOOGL', name: 'Alphabet Google', weight: 0.12 },
      { symbol: 'META', name: 'Meta Platforms', weight: 0.10 },
      { symbol: 'TSLA', name: 'Tesla Inc', weight: 0.05 }
    ]
  },
  dividend_aristocrats: {
    id: 'dividend_aristocrats',
    name: 'Wall Street Dividend Aristocrats',
    tagline: 'Defensive blue-chip cash-flow compounders with regular quarterly yield',
    icon: '🏦',
    badgeColor: 'amber',
    annualizedReturn: 16.5,
    dividendYield: 3.6,
    riskLevel: 'Conservative',
    minInvestment: 50,
    holdings: [
      { symbol: 'JPM', name: 'JPMorgan Chase', weight: 0.35 },
      { symbol: 'BRK.B', name: 'Berkshire Hathaway', weight: 0.35 },
      { symbol: 'V', name: 'Visa Inc', weight: 0.30 }
    ]
  },
  future_mobility: {
    id: 'future_mobility',
    name: 'Autonomous Mobility & Entertainment',
    tagline: 'Next-generation robotics, entertainment streaming & ride networks',
    icon: '⚡',
    badgeColor: 'purple',
    annualizedReturn: 22.8,
    dividendYield: 1.8,
    riskLevel: 'Moderate',
    minInvestment: 50,
    holdings: [
      { symbol: 'TSLA', name: 'Tesla Inc', weight: 0.35 },
      { symbol: 'UBER', name: 'Uber Tech', weight: 0.25 },
      { symbol: 'NFLX', name: 'Netflix Inc', weight: 0.25 },
      { symbol: 'DIS', name: 'Walt Disney Co', weight: 0.15 }
    ]
  }
};

// Annual dividend APYs for held equities
const STOCK_DIVIDEND_RATES = {
  'JPM': 0.034, // 3.4% APY
  'AAPL': 0.015, // 1.5% APY
  'MSFT': 0.018, // 1.8% APY
  'V': 0.014, // 1.4% APY
  'BRK.B': 0.021, // 2.1% APY
  'DIS': 0.019, // 1.9% APY
  'LLY': 0.016, // 1.6% APY
  'BABA': 0.022 // 2.2% APY
};

module.exports = {
  STOCK_BASKETS,
  STOCK_DIVIDEND_RATES
};
