const requireAuth = (req, res, next) => {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.redirect('/login');
  }
  if (req.user?.account_status === 'deleted' || Number(req.user?.is_active) === 0) {
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
  return next();
};

const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).send('Forbidden: insufficient privileges.');
  }
  return next();
};

module.exports = { requireAuth, requireRole };
