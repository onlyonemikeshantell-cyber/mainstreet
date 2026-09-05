// 24/7 Crypto Trading Session & On-Chain Intelligence Service

const getCryptoSessionData = () => {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const utcMin = now.getUTCMinutes();
  const utcSec = now.getUTCSeconds();

  // 1. Determine Active Crypto Liquidity Phase
  let activePhase = 'US Institutional Wave';
  let phaseDescription = 'Peak spot & CME derivatives liquidity.';
  let isApacOpen = (utcHour >= 0 && utcHour < 8);
  let isEuOpen = (utcHour >= 8 && utcHour < 14);
  let isUsOpen = (utcHour >= 14 && utcHour < 21);
  let isPacificOpen = (utcHour >= 21 || utcHour < 0);

  if (isApacOpen) {
    activePhase = 'APAC / Asian Session (Tokyo/HK/SG)';
    phaseDescription = 'Heavy altcoin volatility & Asian derivatives volume.';
  } else if (isEuOpen) {
    activePhase = 'European Institutional (London/Frankfurt)';
    phaseDescription = 'Euro liquidity & institutional OTC Bitcoin flows.';
  } else if (isUsOpen) {
    activePhase = 'US Institutional (New York/Chicago)';
    phaseDescription = 'Spot ETF inflows & CME futures peak volume.';
  } else {
    activePhase = 'Global Decentralized (Round-the-Clock)';
    phaseDescription = 'Global 24/7 retail & decentralized protocol flows.';
  }

  // 2. Next Funding Countdown (Every 8h at 00:00, 08:00, 16:00 UTC)
  const nextFundingHour = (Math.floor(utcHour / 8) + 1) * 8;
  const hoursLeft = (nextFundingHour - utcHour - 1 + 24) % 8;
  const minsLeft = 59 - utcMin;
  const secsLeft = 59 - utcSec;
  const fundingCountdown = `${String(hoursLeft).padStart(2, '0')}:${String(minsLeft).padStart(2, '0')}:${String(secsLeft).padStart(2, '0')}`;

  return {
    timestamp: Date.now(),
    utcTime: `${String(utcHour).padStart(2, '0')}:${String(utcMin).padStart(2, '0')}:${String(utcSec).padStart(2, '0')} UTC`,
    activePhase,
    phaseDescription,
    phases: {
      apac: { name: 'APAC (00-08h)', isOpen: isApacOpen },
      eu: { name: 'EUROPE (08-14h)', isOpen: isEuOpen },
      us: { name: 'US / CME (14-21h)', isOpen: isUsOpen },
      pacific: { name: 'DECENTRALIZED (21-00h)', isOpen: isPacificOpen }
    },
    onChain: {
      fearAndGreedScore: 74,
      fearAndGreedSentiment: 'Greed',
      btcDominance: '55.4%',
      ethGasGwei: 14,
      gasStatus: 'Optimal (<15 Gwei)',
      globalMarketCap: '$2.54 Trillion',
      globalVolume24h: '$98.2 Billion',
      fundingRate: '+0.0100%',
      fundingCountdown,
      longRatio: 64.2,
      shortRatio: 35.8,
      liquidations24h: '$142.8M (78% Shorts)'
    }
  };
};

module.exports = {
  getCryptoSessionData
};
