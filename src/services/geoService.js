// ==============================================================================
// MAINSTREET CAPITAL EXCHANGE - GEOLOCATION & LANGUAGE SERVICE
// Automatic language detection based on IP address and country routing
// ==============================================================================

const COUNTRY_TO_LANG = {
  // Spanish (Spain & Latin America)
  'ES': 'es', 'MX': 'es', 'AR': 'es', 'CO': 'es', 'CL': 'es', 'PE': 'es', 'VE': 'es',
  'GT': 'es', 'EC': 'es', 'CU': 'es', 'BO': 'es', 'DO': 'es', 'HN': 'es', 'PY': 'es',
  'SV': 'es', 'NI': 'es', 'CR': 'es', 'PA': 'es', 'UY': 'es', 'PR': 'es', 'GQ': 'es',

  // French
  'FR': 'fr', 'MC': 'fr', 'SN': 'fr', 'CI': 'fr', 'CM': 'fr', 'CD': 'fr', 'CG': 'fr',
  'ML': 'fr', 'NE': 'fr', 'BF': 'fr', 'GN': 'fr', 'BJ': 'fr', 'TG': 'fr', 'GA': 'fr',
  'HT': 'fr', 'LU': 'fr',

  // German
  'DE': 'de', 'AT': 'de', 'LI': 'de', 'CH': 'de',

  // Italian
  'IT': 'it', 'SM': 'it', 'VA': 'it',

  // Portuguese
  'PT': 'pt', 'BR': 'pt', 'AO': 'pt', 'MZ': 'pt', 'CV': 'pt', 'GW': 'pt', 'ST': 'pt',

  // Russian
  'RU': 'ru', 'BY': 'ru', 'KZ': 'ru', 'KG': 'ru',

  // Chinese
  'CN': 'zh-CN', 'TW': 'zh-TW', 'HK': 'zh-TW', 'MO': 'zh-TW', 'SG': 'zh-CN',

  // Japanese
  'JP': 'ja',

  // Korean
  'KR': 'ko',

  // Arabic
  'SA': 'ar', 'AE': 'ar', 'EG': 'ar', 'QA': 'ar', 'KW': 'ar', 'BH': 'ar', 'OM': 'ar',
  'JO': 'ar', 'LB': 'ar', 'IQ': 'ar', 'DZ': 'ar', 'MA': 'ar', 'TN': 'ar', 'LY': 'ar',
  'SD': 'ar', 'YE': 'ar',

  // Turkish
  'TR': 'tr', 'CY': 'tr',

  // Dutch
  'NL': 'nl', 'SR': 'nl', 'BE': 'nl',

  // Polish
  'PL': 'pl',

  // Swedish
  'SE': 'sv',

  // Norwegian
  'NO': 'no',

  // Danish
  'DK': 'da',

  // Finnish
  'FI': 'fi',

  // Greek
  'GR': 'el',

  // Czech
  'CZ': 'cs',

  // Romanian
  'RO': 'ro', 'MD': 'ro',

  // Hungarian
  'HU': 'hu',

  // Ukrainian
  'UA': 'uk',

  // Vietnamese
  'VN': 'vi',

  // Thai
  'TH': 'th',

  // Indonesian
  'ID': 'id',

  // Malay
  'MY': 'ms',

  // Hindi (India)
  'IN': 'hi',

  // Tagalog (Philippines)
  'PH': 'tl',

  // Hebrew
  'IL': 'iw',

  // Persian
  'IR': 'fa',

  // Urdu (Pakistan)
  'PK': 'ur',

  // Bengali (Bangladesh)
  'BD': 'bn',

  // English (default fallback)
  'US': 'en', 'GB': 'en', 'CA': 'en', 'AU': 'en', 'NZ': 'en', 'IE': 'en', 'ZA': 'en', 'NG': 'en', 'GH': 'en', 'KE': 'en'
};

const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English', native: 'English', flag: '🇺🇸' },
  { code: 'es', name: 'Spanish', native: 'Español', flag: '🇪🇸' },
  { code: 'fr', name: 'French', native: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'German', native: 'Deutsch', flag: '🇩🇪' },
  { code: 'it', name: 'Italian', native: 'Italiano', flag: '🇮🇹' },
  { code: 'pt', name: 'Portuguese', native: 'Português', flag: '🇧🇷' },
  { code: 'ru', name: 'Russian', native: 'Русский', flag: '🇷🇺' },
  { code: 'zh-CN', name: 'Chinese (Simplified)', native: '简体中文', flag: '🇨🇳' },
  { code: 'zh-TW', name: 'Chinese (Traditional)', native: '繁體中文', flag: '🇹🇼' },
  { code: 'ja', name: 'Japanese', native: '日本語', flag: '🇯🇵' },
  { code: 'ko', name: 'Korean', native: '한국어', flag: '🇰🇷' },
  { code: 'ar', name: 'Arabic', native: 'العربية', flag: '🇸🇦' },
  { code: 'tr', name: 'Turkish', native: 'Türkçe', flag: '🇹🇷' },
  { code: 'nl', name: 'Dutch', native: 'Nederlands', flag: '🇳🇱' },
  { code: 'pl', name: 'Polish', native: 'Polski', flag: '🇵🇱' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी', flag: '🇮🇳' },
  { code: 'id', name: 'Indonesian', native: 'Bahasa Indonesia', flag: '🇮🇩' },
  { code: 'vi', name: 'Vietnamese', native: 'Tiếng Việt', flag: '🇻🇳' },
  { code: 'th', name: 'Thai', native: 'ไทย', flag: '🇹🇭' },
  { code: 'uk', name: 'Ukrainian', native: 'Українська', flag: '🇺🇦' },
  { code: 'el', name: 'Greek', native: 'Ελληνικά', flag: '🇬🇷' },
  { code: 'sv', name: 'Swedish', native: 'Svenska', flag: '🇸🇪' }
];

function getVisitorIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const list = forwarded.split(',');
    return list[0].trim();
  }
  return req.headers['x-real-ip'] || req.ip || (req.socket && req.socket.remoteAddress) || '';
}

function detectGeoFromRequest(req) {
  // Cloudflare provides 'cf-ipcountry' header directly
  const cfCountry = req.headers['cf-ipcountry'];
  if (cfCountry && cfCountry.length === 2 && cfCountry !== 'XX' && cfCountry !== 'T1') {
    const countryUpper = cfCountry.toUpperCase();
    const lang = COUNTRY_TO_LANG[countryUpper] || 'en';
    return {
      country: countryUpper,
      lang: lang,
      ip: getVisitorIP(req),
      source: 'cloudflare'
    };
  }

  // Other proxy country headers (e.g. cPanel, AWS CloudFront, Fastly)
  const proxyCountry = req.headers['x-country-code'] || req.headers['cloudfront-viewer-country'];
  if (proxyCountry && proxyCountry.length === 2) {
    const countryUpper = proxyCountry.toUpperCase();
    const lang = COUNTRY_TO_LANG[countryUpper] || 'en';
    return {
      country: countryUpper,
      lang: lang,
      ip: getVisitorIP(req),
      source: 'proxy_header'
    };
  }

  // Accept-Language header fallback
  const acceptLang = req.headers['accept-language'];
  let langFromHeader = 'en';
  if (acceptLang) {
    const primary = acceptLang.split(',')[0].split(';')[0].trim().toLowerCase();
    const short = primary.split('-')[0];
    if (SUPPORTED_LANGUAGES.some(l => l.code.toLowerCase() === short)) {
      langFromHeader = short;
    }
  }

  return {
    country: null,
    lang: langFromHeader,
    ip: getVisitorIP(req),
    source: 'client_header'
  };
}

module.exports = {
  COUNTRY_TO_LANG,
  SUPPORTED_LANGUAGES,
  detectGeoFromRequest,
  getVisitorIP
};
