const crypto = require('crypto');

const EXEMPT_PREFIXES = [
  '/api/webhooks',
  '/api/wallet/wc-session',
  '/api/market/sync-live-price',
  '/api/notifications',
  '/register/send-otp',
  '/register/verify-otp',
  '/logout',
  '/babyoku/logout',
  '/admin/logout',
  '/signout'
];

const csrfMiddleware = (req, res, next) => {
  // Ensure session has a cryptographically strong CSRF token
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;

  // Safe HTTP read methods do not change state
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }

  // Exempt external webhooks with their own signature authentication
  for (const prefix of EXEMPT_PREFIXES) {
    if (req.path.startsWith(prefix)) {
      return next();
    }
  }

  // Extract client token from request body or request headers
  const clientToken = (
    (req.body && (req.body._token || req.body._csrf)) ||
    req.headers['x-csrf-token'] ||
    req.headers['csrf-token'] ||
    ''
  ).trim();

  // Validate token
  if (!clientToken || clientToken !== req.session.csrfToken) {
    if (req.xhr || req.headers.accept?.includes('application/json') || req.path.startsWith('/api/')) {
      return res.status(403).json({ 
        success: false, 
        error: 'Forbidden: Invalid or missing CSRF security token. Please refresh the page and try again.' 
      });
    }

    req.session.flash = { error: 'Your session security token has expired. Please resubmit the form.' };
    return res.redirect(req.headers.referer || req.path || '/');
  }

  next();
};

module.exports = csrfMiddleware;
