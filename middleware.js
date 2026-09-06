const db = require('./db');

const requireAuth = (req, res, next) => {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    // Remembered so POST /login and the OAuth callbacks (see app.js) can send the user
    // back to whatever they actually asked for instead of always landing on /dashboard —
    // only for GET requests, since replaying a POST after login would resubmit a form
    // without its original data.
    if (req.method === 'GET' && req.session) {
      req.session.returnTo = req.originalUrl;
    }
    return res.redirect('/login');
  }
  if (db.isDeletedAccount(req.user) || Number(req.user?.is_active) === 0) {
    const redirectToLogin = () => {
      if (req.flash) req.flash('error', 'This account is no longer active.');
      return res.redirect('/login');
    };
    if (typeof req.logout === 'function') {
      return req.logout((error) => {
        if (error) return next(error);
        return redirectToLogin();
      });
    }
    return redirectToLogin();
  }
  if (Number(req.user?.must_change_password) === 1 && req.path !== '/account/password') {
    if (req.flash) req.flash('error', 'Please set a new password before continuing.');
    return res.redirect('/account/password');
  }
  return next();
};

const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).send('Forbidden: insufficient privileges.');
  }
  return next();
};

module.exports = { requireAuth, requireRole };
