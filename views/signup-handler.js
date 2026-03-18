// ─── Replace the existing app.post('/signup', ...) block in app.js with this ───

app.post('/signup', (req, res) => {
  const { email, password, requestedRole, inviteCode, fullName } = req.body;

  if (!email || !password) {
    req.flash('error', 'Email and password are required.');
    return res.redirect('/signup');
  }

  const normalizedEmail = email.toLowerCase();
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (exists) {
    req.flash('error', 'Account already exists. Please log in.');
    return res.redirect('/login');
  }

  // Default everyone to 'parent' unless they checked a staff role AND supplied
  // the correct invite code for that role.
  let role = 'parent';

  if (normalizedEmail === process.env.ADMIN_EMAIL?.toLowerCase()) {
    // Hard-coded admin email always gets admin regardless of form input
    role = 'admin';
  } else if (requestedRole === 'admin' && inviteCode === process.env.ADMIN_INVITE_CODE) {
    role = 'admin';
  } else if (requestedRole === 'catechist' && inviteCode === process.env.CATECHIST_INVITE_CODE) {
    role = 'catechist';
  } else if (requestedRole === 'admin' || requestedRole === 'catechist') {
    // They checked a staff role but the invite code was wrong — reject clearly
    req.flash('error', 'Invalid invite code. Your account was not created. Please try again or contact the parish office.');
    return res.redirect('/signup');
  }
  // If requestedRole is blank/undefined (no checkbox checked), role stays 'parent'

  const hash = bcrypt.hashSync(password, 10);
  db.prepare(
    'INSERT INTO users (email, password_hash, role, provider, full_name) VALUES (?, ?, ?, ?, ?)',
  ).run(normalizedEmail, hash, role, 'local', fullName || '');

  req.flash('success', 'Account created. Please log in.');
  return res.redirect('/login');
});
