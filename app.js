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

const translations = {
  en: {
    app_title: 'Saint Matthew Catholic Church',
    reg_title: 'Registration for Religious Education',
    school_year: 'School Year 2025-2026',
    secure_online: 'Secure online registration for families, catechists, and administrators.',
    create_account: 'Create Account',
    login: 'Login',
    logout: 'Logout',
    open_dashboard: 'Open Dashboard',
    dashboard: 'Dashboard',
    signed_in_as: 'Signed in as',
    new_registration: 'New Registration',
    manage_users: 'Manage Users',
    submitted_registrations: 'Submitted Registrations',
    student: 'Student',
    grade: 'Grade',
    parent: 'Parent',
    primary_contact: 'Primary Contact',
    total_fees: 'Total Fees',
    certificates: 'Certificates',
    baptism: 'Baptism',
    communion: 'Communion',
    user_administration: 'User Administration',
    back_to_dashboard: 'Back to Dashboard',
    email: 'Email',
    role: 'Role',
    provider: 'Provider',
    update_role: 'Update Role',
    save: 'Save',
    create_login: 'Create Login',
    full_name: 'Full Name',
    password: 'Password',
    role_request: 'Role Request',
    invite_code: 'Invite Code (required for admin/catechist)',
    already_have_account: 'Already have an account?',
    continue_free_providers: 'Or continue with free providers:',
    need_account: 'Need an account?',
    sign_up: 'Sign up',
    registration_form_title: 'Parent & Student Registration Form',
    back: 'Back',
    primary_parent_contact: 'Primary Parent Contact',
    primary_contact_phone: 'Primary Contact Phone',
    primary_contact_email: 'Primary Contact Email',
    relationship: 'Relationship',
    relationship_other: 'If Other, please describe',
    father_mother: 'Father/Mother',
    step_parent_rel: 'Stepfather/Stepmother',
    other: 'Other',
    address: 'ADDRESS',
    city_state_zip: 'CITY, STATE AND ZIP',
    home_phone: 'HOME PHONE #',
    father_name: 'FATHER’S NAME',
    father_religion: 'FATHER RELIGION',
    father_cell: 'FATHER’S CELL PHONE #',
    mother_maiden_name: 'MOTHER’S MAIDEN NAME',
    mother_religion: 'MOTHER RELIGION',
    mother_cell: 'MOTHER’S CELL PHONE #',
    child_lives_with: 'CHILD LIVES WITH',
    both: 'Both',
    father: 'Father',
    mother: 'Mother',
    step_parent_name: 'STEP-PARENT’S NAME',
    step_parent_religion: 'STEP-PARENT RELIGION',
    student_full_name: 'STUDENT’S FULL NAME',
    gender: 'GENDER',
    male: 'Male',
    female: 'Female',
    age: 'AGE',
    dob: 'DATE OF BIRTH',
    place_of_birth: 'CHILD’S PLACE OF BIRTH',
    ccd_grade_level: 'CCD GRADE LEVEL (CLASS CODE)',
    school_grade_level: 'SCHOOL GRADE LEVEL',
    school_attending: 'SCHOOL ATTENDING',
    baptism_date: 'BAPTISM DATE',
    baptism_church: 'BAPTISM CHURCH / CITY / STATE',
    first_communion_date: 'FIRST COMMUNION DATE',
    first_communion_church: 'FIRST COMMUNION CHURCH / CITY / STATE',
    comments: 'HANDICAPS / LEARNING DISABILITIES / COMMENTS',
    family_count: 'Family children count (for fee)',
    parent_signature: 'SIGNATURE OF PARENT / GUARDIAN',
    upload_scans: 'Upload Certificate Scans',
    baptism_required: 'Baptism Certificate (required if first year)',
    communion_required: 'First Holy Communion Certificate (required for 3rd grade+)',
    fee_notice: 'Fees: $150 one child / $200 family; sacramental fee $25 for second grade/SS2, $50 for second-year Confirmation. Late fee $50 after Aug 15, 2025. No registrations accepted after Sept 8, 2025.',
    submit_registration: 'Submit Registration',
    cancel: 'Cancel',
    footer_note: 'Please print clearly and verify sacramental records before submission.',
    language: 'Language',
    english: 'English',
    spanish: 'Spanish',
    registration_date_auto: 'Registration Date (auto-set by system)'
  },
  es: {
    app_title: 'Iglesia Católica San Mateo',
    reg_title: 'Inscripción para Educación Religiosa',
    school_year: 'Año Escolar 2025-2026',
    secure_online: 'Inscripción segura en línea para familias, catequistas y administradores.',
    create_account: 'Crear Cuenta',
    login: 'Iniciar sesión',
    logout: 'Cerrar sesión',
    open_dashboard: 'Abrir Panel',
    dashboard: 'Panel',
    signed_in_as: 'Conectado como',
    new_registration: 'Nueva Inscripción',
    manage_users: 'Administrar Usuarios',
    submitted_registrations: 'Inscripciones Enviadas',
    student: 'Estudiante',
    grade: 'Grado',
    parent: 'Padre/Madre',
    primary_contact: 'Contacto Primario',
    total_fees: 'Total de Cuotas',
    certificates: 'Certificados',
    baptism: 'Bautismo',
    communion: 'Comunión',
    user_administration: 'Administración de Usuarios',
    back_to_dashboard: 'Volver al Panel',
    email: 'Correo Electrónico',
    role: 'Rol',
    provider: 'Proveedor',
    update_role: 'Actualizar Rol',
    save: 'Guardar',
    create_login: 'Crear Acceso',
    full_name: 'Nombre Completo',
    password: 'Contraseña',
    role_request: 'Solicitud de Rol',
    invite_code: 'Código de Invitación (requerido para admin/catequista)',
    already_have_account: '¿Ya tienes una cuenta?',
    continue_free_providers: 'O continúa con proveedores gratuitos:',
    need_account: '¿Necesitas una cuenta?',
    sign_up: 'Regístrate',
    registration_form_title: 'Formulario de Inscripción de Padre y Estudiante',
    back: 'Volver',
    primary_parent_contact: 'Contacto Primario de Padre/Madre',
    primary_contact_phone: 'Teléfono del Contacto Primario',
    primary_contact_email: 'Correo del Contacto Primario',
    relationship: 'Relación',
    relationship_other: 'Si elige Otro, describa',
    father_mother: 'Padre/Madre',
    step_parent_rel: 'Padrastro/Madrastra',
    other: 'Otro',
    address: 'DIRECCIÓN',
    city_state_zip: 'CIUDAD, ESTADO Y CÓDIGO POSTAL',
    home_phone: 'TELÉFONO DE CASA #',
    father_name: 'NOMBRE DEL PADRE',
    father_religion: 'RELIGIÓN DEL PADRE',
    father_cell: 'CELULAR DEL PADRE #',
    mother_maiden_name: 'APELLIDO DE SOLTERA DE LA MADRE',
    mother_religion: 'RELIGIÓN DE LA MADRE',
    mother_cell: 'CELULAR DE LA MADRE #',
    child_lives_with: 'EL NIÑO VIVE CON',
    both: 'Ambos',
    father: 'Padre',
    mother: 'Madre',
    step_parent_name: 'NOMBRE DEL PADRASTRO/MADRASTRA',
    step_parent_religion: 'RELIGIÓN DEL PADRASTRO/MADRASTRA',
    student_full_name: 'NOMBRE COMPLETO DEL ESTUDIANTE',
    gender: 'GÉNERO',
    male: 'Masculino',
    female: 'Femenino',
    age: 'EDAD',
    dob: 'FECHA DE NACIMIENTO',
    place_of_birth: 'LUGAR DE NACIMIENTO DEL NIÑO',
    ccd_grade_level: 'GRADO CCD (CÓDIGO DE CLASE)',
    school_grade_level: 'GRADO ESCOLAR',
    school_attending: 'ESCUELA A LA QUE ASISTE',
    baptism_date: 'FECHA DE BAUTISMO',
    baptism_church: 'IGLESIA DE BAUTISMO / CIUDAD / ESTADO',
    first_communion_date: 'FECHA DE PRIMERA COMUNIÓN',
    first_communion_church: 'IGLESIA DE PRIMERA COMUNIÓN / CIUDAD / ESTADO',
    comments: 'DISCAPACIDADES / DIFICULTADES DE APRENDIZAJE / COMENTARIOS',
    family_count: 'Cantidad de hijos en la familia (para cuota)',
    parent_signature: 'FIRMA DEL PADRE / TUTOR',
    upload_scans: 'Subir Escaneos de Certificados',
    baptism_required: 'Certificado de Bautismo (requerido si es el primer año)',
    communion_required: 'Certificado de Primera Comunión (requerido para 3er grado en adelante)',
    fee_notice: 'Cuotas: $150 por un hijo / $200 por familia; cuota sacramental de $25 para segundo grado/SS2, $50 para segundo año de Confirmación. Recargo de $50 después del 15 de agosto de 2025. No se aceptan inscripciones después del 8 de septiembre de 2025.',
    submit_registration: 'Enviar Inscripción',
    cancel: 'Cancelar',
    footer_note: 'Por favor escriba claramente y verifique los registros sacramentales antes de enviar.',
    language: 'Idioma',
    english: 'Inglés',
    spanish: 'Español',
    registration_date_auto: 'Fecha de inscripción (asignada automáticamente por el sistema)'
  }
};


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

app.get('/lang/:lang', (req, res) => {
  const selected = req.params.lang === 'es' ? 'es' : 'en';
  req.session.lang = selected;
  res.redirect(req.get('referer') || '/');
});

app.use((req, res, next) => {
  const lang = req.session.lang === 'es' ? 'es' : 'en';
  res.locals.lang = lang;
  res.locals.t = (key) => translations[lang][key] || translations.en[key] || key;
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
  const today = new Date().toISOString().slice(0, 10);
  res.render('registration-form', { today });
});

app.post(
  '/registration',
  requireAuth,
  upload.fields([
    { name: 'baptism_certificate', maxCount: 1 },
    { name: 'first_communion_certificate', maxCount: 1 },
  ]),
  (req, res) => {
    const fees = calculateFees(req.body.family_count, req.body.ccd_grade_level, null);
    if (fees.afterStart) {
      req.flash('error', 'Registration closed: no registrations accepted after classes begin on Sept. 8, 2025.');
      return res.redirect('/registration/new');
    }

    const baptismCert = req.files?.baptism_certificate?.[0]?.path || null;
    const communionCert = req.files?.first_communion_certificate?.[0]?.path || null;

    db.prepare(`
      INSERT INTO student_registrations (
        user_id, school_year, parent_name, primary_contact_phone, primary_contact_email,
        primary_contact_relationship, primary_contact_relationship_other, address, city_state_zip, home_phone,
        father_name, father_religion, father_cell, mother_maiden_name, mother_religion, mother_cell,
        child_lives_with, step_parent_name, step_parent_religion, student_full_name, student_gender,
        student_age, student_dob, child_place_of_birth, ccd_grade_level, school_attending,
        school_grade_level, baptism_date, baptism_church, first_communion_date, first_communion_church,
        disabilities_comments, parent_signature, email, registration_fee, sacramental_fee, late_fee,
        baptism_certificate_path, first_communion_certificate_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.user.id,
      req.body.school_year || '2025-2026',
      req.user.full_name || req.body.primary_contact_email || req.user.email,
      req.body.primary_contact_phone,
      req.body.primary_contact_email,
      req.body.primary_contact_relationship,
      req.body.primary_contact_relationship === 'Other' ? req.body.primary_contact_relationship_other : null,
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
