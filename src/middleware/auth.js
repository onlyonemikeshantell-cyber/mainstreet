const db = require('../db');
const { detectGeoFromRequest } = require('../services/geoService');

const requireAuth = (req, res, next) => {
  if (!req.session.userId) {
    if (req.xhr || req.headers.accept?.includes('application/json') || req.path.startsWith('/api/')) {
      return res.status(401).json({ success: false, error: 'Please login to access this section.' });
    }
    req.session.flash = { error: 'Please login to access this section.' };
    return res.redirect('/login');
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!user || user.is_active === 0) {
    req.session.destroy(() => {
      res.clearCookie('connect.sid');
      res.redirect('/login');
    });
    return;
  }
  if (user.role !== 'admin') {
    if (user.email_verified === 0) {
      if (req.xhr || req.headers.accept?.includes('application/json') || req.path.startsWith('/api/')) {
        return res.status(403).json({ success: false, error: 'Email verification required.' });
      }
      req.session.flash = { error: 'Step 2 of 4: Please verify your email address to proceed.' };
      return req.session.save(() => res.redirect('/verify-email'));
    }
    if (user.kyc_status !== 'verified') {
      if (req.xhr || req.headers.accept?.includes('application/json') || req.path.startsWith('/api/')) {
        return res.status(403).json({ success: false, error: 'Your KYC verification must be approved before accessing your account.' });
      }
      req.session.flash = { error: 'Please wait until your KYC verification is approved before accessing your account.' };
      return req.session.save(() => res.redirect('/onboarding/kyc'));
    }
  }
  next();
};

const requireAdmin = (req, res, next) => {
  const effectiveAdminId = req.session.adminId || req.session.userId;
  if (!effectiveAdminId) {
    return res.redirect('/babyoku/login');
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(effectiveAdminId);
  if (!user || user.role !== 'admin' || user.is_active === 0) {
    req.session.flash = { error: 'Access denied. Administrator privileges required.' };
    return res.redirect('/babyoku/login');
  }
  next();
};

const injectUser = (req, res, next) => {
  if (req.session.userId) {
    try {
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
      if (user && user.is_active !== 0) {
        res.locals.user = user;
      } else {
        req.session.userId = null;
        res.locals.user = null;
      }
    } catch (e) {
      res.locals.user = null;
    }
  } else {
    res.locals.user = null;
  }
  res.locals.isImpersonating = !!req.session.adminId;
  res.locals.adminId = req.session.adminId || null;
  res.locals.flash = req.session.flash || {};
  req.session.flash = null;
  res.locals.csrfToken = req.session.csrfToken || 'txe_default_token';
  res.locals.currentPath = req.path;
  res.locals.visitorGeo = detectGeoFromRequest(req);
  res.locals.safeJson = (obj) => {
    return JSON.stringify(obj === undefined ? null : obj)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
  };
  next();
};

module.exports = { requireAuth, requireAdmin, injectUser };
