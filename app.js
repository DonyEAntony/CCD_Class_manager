require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const passport = require('./auth');
const db = require('./db');
const { requireAuth, requireRole } = require('./middleware');

const app = express();
const PORT = process.env.PORT || 3000;

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    cb(null, `${Date.now()}-${safe}`);
  },
});
const upload = multer({ storage });

app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'change-me',
    resave: false,
    saveUninitialized: false,
  }),
);
app.use(flash());
app.use(passport.initialize());
app.use(passport.session());

app.use((req, res, next) => {
  res.locals.user = req.user;
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  next();
});

const calculateFees = (familyCount, gradeLevel, registrationDateStr) => {
  const registrationFee = Number(familyCount) > 1 ? 200 : 150;
  const grade = `${gradeLevel}`.toLowerCase();
  const sacramentalFee = grade.includes('2') ? 25 : grade.includes('confirmation') ? 50 : 0;

  const registrationDate = registrationDateStr ? new Date(registrationDateStr) : new Date();
  const deadline = new Date('2025-08-15T23:59:59');
  const classesBegin = new Date('2025-09-08T00:00:00');

  const lateFee = registrationDate > deadline && registrationDate < classesBegin ? 50 : 0;
  return { registrationFee, sacramentalFee, lateFee, afterStart: registrationDate >= classesBegin };
};

app.get('/', (req, res) => res.render('index'));

app.get('/signup', (req, res) => res.render('signup'));
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

  let role = 'parent';
  if (normalizedEmail === process.env.ADMIN_EMAIL?.toLowerCase()) {
    role = 'admin';
  } else if (requestedRole === 'catechist' && inviteCode === process.env.CATECHIST_INVITE_CODE) {
    role = 'catechist';
  } else if (requestedRole === 'admin' && inviteCode === process.env.ADMIN_INVITE_CODE) {
    role = 'admin';
  }

  const hash = bcrypt.hashSync(password, 10);
  db.prepare(
    'INSERT INTO users (email, password_hash, role, provider, full_name) VALUES (?, ?, ?, ?, ?)',
  ).run(normalizedEmail, hash, role, 'local', fullName || '');

  req.flash('success', 'Account created. Please log in.');
  return res.redirect('/login');
});

app.get('/login', (req, res) => res.render('login'));
app.post(
  '/login',
  passport.authenticate('local', {
    successRedirect: '/dashboard',
    failureRedirect: '/login',
    failureFlash: true,
  }),
);

app.get('/auth/google', (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID) return res.status(503).send('Google auth not configured.');
  return passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});
app.get('/auth/google/callback',
  passport.authenticate('google', {
    successRedirect: '/dashboard',
    failureRedirect: '/login',
    failureFlash: true,
  }));

app.get('/auth/github', (req, res, next) => {
  if (!process.env.GITHUB_CLIENT_ID) return res.status(503).send('GitHub auth not configured.');
  return passport.authenticate('github', { scope: ['user:email'] })(req, res, next);
});
app.get('/auth/github/callback',
  passport.authenticate('github', {
    successRedirect: '/dashboard',
    failureRedirect: '/login',
    failureFlash: true,
  }));

app.get('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    return res.redirect('/');
  });
});

app.get('/dashboard', requireAuth, (req, res) => {
  let registrations = [];
  if (req.user.role === 'parent') {
    registrations = db.prepare('SELECT * FROM student_registrations WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  } else {
    registrations = db.prepare('SELECT * FROM student_registrations ORDER BY created_at DESC').all();
  }

  res.render('dashboard', { registrations });
});

app.get('/registration/new', requireAuth, requireRole('parent', 'admin', 'catechist'), (req, res) => {
  res.render('registration-form');
});

app.post(
  '/registration',
  requireAuth,
  upload.fields([
    { name: 'baptism_certificate', maxCount: 1 },
    { name: 'first_communion_certificate', maxCount: 1 },
  ]),
  (req, res) => {
    const fees = calculateFees(req.body.family_count, req.body.ccd_grade_level, req.body.registration_date);
    if (fees.afterStart) {
      req.flash('error', 'Registration closed: no registrations accepted after classes begin on Sept. 8, 2025.');
      return res.redirect('/registration/new');
    }

    const baptismCert = req.files?.baptism_certificate?.[0]?.path || null;
    const communionCert = req.files?.first_communion_certificate?.[0]?.path || null;

    db.prepare(`
      INSERT INTO student_registrations (
        user_id, school_year, parent_name, address, city_state_zip, home_phone,
        father_name, father_religion, father_cell, mother_maiden_name, mother_religion, mother_cell,
        child_lives_with, step_parent_name, step_parent_religion, student_full_name, student_gender,
        student_age, student_dob, child_place_of_birth, ccd_grade_level, school_attending,
        school_grade_level, baptism_date, baptism_church, first_communion_date, first_communion_church,
        disabilities_comments, parent_signature, email, registration_fee, sacramental_fee, late_fee,
        baptism_certificate_path, first_communion_certificate_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.user.id,
      req.body.school_year || '2025-2026',
      req.body.parent_name,
      req.body.address,
      req.body.city_state_zip,
      req.body.home_phone,
      req.body.father_name,
      req.body.father_religion,
      req.body.father_cell,
      req.body.mother_maiden_name,
      req.body.mother_religion,
      req.body.mother_cell,
      req.body.child_lives_with,
      req.body.step_parent_name,
      req.body.step_parent_religion,
      req.body.student_full_name,
      req.body.student_gender,
      req.body.student_age || null,
      req.body.student_dob,
      req.body.child_place_of_birth,
      req.body.ccd_grade_level,
      req.body.school_attending,
      req.body.school_grade_level,
      req.body.baptism_date,
      req.body.baptism_church,
      req.body.first_communion_date,
      req.body.first_communion_church,
      req.body.disabilities_comments,
      req.body.parent_signature,
      req.body.email,
      fees.registrationFee,
      fees.sacramentalFee,
      fees.lateFee,
      baptismCert,
      communionCert,
    );

    req.flash('success', `Registration submitted. Fees: $${fees.registrationFee + fees.sacramentalFee + fees.lateFee}`);
    return res.redirect('/dashboard');
  },
);

app.get('/admin/users', requireAuth, requireRole('admin'), (req, res) => {
  const users = db.prepare('SELECT id, email, role, provider, created_at FROM users ORDER BY created_at DESC').all();
  res.render('admin-users', { users });
});

app.post('/admin/users/:id/role', requireAuth, requireRole('admin'), (req, res) => {
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(req.body.role, req.params.id);
  req.flash('success', 'User role updated.');
  res.redirect('/admin/users');
});

app.listen(PORT, () => {
  console.log(`St Matthew CCD app running at http://localhost:${PORT}`);
});
