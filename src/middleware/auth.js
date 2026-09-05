const db = require('../db');

const requireAuth = (req, res, next) => {
  if (!req.session.userId) {
    req.session.flash = { error: 'Please login to access this section.' };
    return res.redirect('/login');
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (user && user.is_active === 0) {
    req.session.destroy(() => {
      res.redirect('/login');
    });
    return;
  }
  next();
};

const requireAdmin = (req, res, next) => {
  const effectiveAdminId = req.session.adminId || req.session.userId;
  if (!effectiveAdminId) {
    return res.redirect('/babyoku/login');
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(effectiveAdminId);
  if (!user || user.role !== 'admin') {
    req.session.flash = { error: 'Access denied. Administrator privileges required.' };
    return res.redirect('/dashboard');
  }
  next();
};

const injectUser = (req, res, next) => {
  if (req.session.userId) {
    try {
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
      res.locals.user = user || null;
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
  next();
};

module.exports = { requireAuth, requireAdmin, injectUser };
