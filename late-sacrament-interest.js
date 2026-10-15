// Interest form for an additional sacramental preparation session, for families who missed
// the children's registration cutoff. A parent submits their contact details once plus one
// or more children. Kept free of Express/DB so it can be unit-tested; app.js turns the
// returned error keys into translated messages.

// Slugs are what get stored (comma-separated for the multi-select groups) and what the
// views translate as `late_sacrament_<slug>`, `late_sacrament_grade_<slug>`,
// `late_sacrament_baptized_<slug>`, `late_sacrament_prior_<slug>`,
// `late_sacrament_availability_<slug>` and `late_sacrament_status_<slug>`.
const LATE_SACRAMENTS = ['baptism', 'first_reconciliation', 'first_communion', 'confirmation'];
const LATE_SACRAMENT_GRADES = ['k', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
const LATE_SACRAMENT_BAPTIZED = ['yes', 'no', 'unsure'];
// Faith formation the child has already had, which tells the office whether they can join
// a second-year group or need to start from the beginning.
const LATE_SACRAMENT_PRIOR_FORMATION = ['none', 'one_year', 'two_plus_years'];
const LATE_SACRAMENT_AVAILABILITY = ['sunday', 'weekday_evening', 'saturday', 'flexible'];
const LATE_SACRAMENT_STATUSES = ['new', 'contacted', 'enrolled', 'not_proceeding'];
const MAX_LATE_SACRAMENT_CHILDREN = 6;

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phoneRegex = /^\d{3}[-.\s]?\d{3}[-.\s]?\d{4}$/;
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const pickOne = (value, allowed) => (allowed.includes(value) ? value : '');
// Checkbox groups arrive as a string (one box), an array (several) or nothing. Anything
// not in the allowed list is dropped, which also discards the objects `extended` body
// parsing can produce from a crafted field name.
const pickAllowed = (value, allowed) => [...new Set([].concat(value || []))].filter((item) => allowed.includes(item));

// A real calendar date, not in the future, and within the age range of children's faith
// formation (roughly 3–21) — catches a parent's birth year typed by mistake.
const isPlausibleBirthDate = (value, today) => {
  if (!dateRegex.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return false;
  const ageYears = (today.getTime() - date.getTime()) / (365.25 * 24 * 3600 * 1000);
  return ageYears >= 3 && ageYears <= 21;
};

// `children[0][first_name]` style fields: extended body parsing gives an array, or an
// object keyed by index once the indices are sparse or past qs's array limit.
const childEntries = (value) => {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
};

const parseChild = (raw) => {
  const child = raw && typeof raw === 'object' ? raw : {};
  return {
    firstName: text(child.first_name, 120),
    lastName: text(child.last_name, 120),
    dateOfBirth: text(child.date_of_birth, 10),
    grade: pickOne(child.grade, LATE_SACRAMENT_GRADES),
    sacraments: pickAllowed(child.sacraments, LATE_SACRAMENTS),
    baptized: pickOne(child.baptized, LATE_SACRAMENT_BAPTIZED),
    baptismParish: text(child.baptism_parish, 255),
    priorFormation: pickOne(child.prior_formation, LATE_SACRAMENT_PRIOR_FORMATION),
  };
};

const isBlankChild = (child) => !child.firstName && !child.lastName && !child.dateOfBirth && !child.grade && !child.sacraments.length;

// Returns { spam, values, errors }. `errors` holds translation keys, each at most once —
// one message per kind of problem reads better than one per child. `spam` is set when the
// hidden honeypot field was filled in; the caller should answer as if it succeeded and
// store nothing.
const parseLateSacramentInterest = (body = {}, today = new Date()) => {
  const children = childEntries(body.children)
    .map(parseChild)
    .filter((child) => !isBlankChild(child))
    .slice(0, MAX_LATE_SACRAMENT_CHILDREN);

  const values = {
    parentName: text(body.parent_name, 255),
    email: text(body.email, 255).toLowerCase(),
    phone: text(body.phone, 50),
    parishioner: body.parishioner === 'yes' || body.parishioner === 'no' ? body.parishioner : '',
    availability: pickAllowed(body.availability, LATE_SACRAMENT_AVAILABILITY),
    notes: text(body.notes, 2000),
    children,
  };

  if (text(body.website, 255)) return { spam: true, values, errors: [] };

  const errors = new Set();
  if (!values.parentName || !values.email || !values.phone) errors.add('late_sacrament_err_required');
  else {
    if (!emailRegex.test(values.email)) errors.add('late_sacrament_err_email');
    if (!phoneRegex.test(values.phone)) errors.add('late_sacrament_err_phone');
  }
  if (!values.parishioner) errors.add('late_sacrament_err_parishioner');

  if (!children.length) errors.add('late_sacrament_err_no_children');
  children.forEach((child) => {
    if (!child.firstName || !child.lastName || !child.dateOfBirth || !child.grade || !child.baptized) errors.add('late_sacrament_err_child_required');
    else if (!isPlausibleBirthDate(child.dateOfBirth, today)) errors.add('late_sacrament_err_child_dob');
    if (!child.sacraments.length) errors.add('late_sacrament_err_child_sacraments');
  });

  return { spam: false, values, errors: [...errors] };
};

// Who is told about a new submission: SACRAMENT_INTEREST_NOTIFY_EMAIL (one address or a
// comma/semicolon-separated list), falling back to the app's ADMIN_EMAIL. Entries that
// aren't valid addresses are dropped, so a typo in one doesn't stop the others receiving it.
const getLateSacramentNotificationRecipients = (env = process.env) => [...new Set(
  `${env.SACRAMENT_INTEREST_NOTIFY_EMAIL || env.ADMIN_EMAIL || ''}`
    .split(/[,;]/)
    .map((address) => address.trim().toLowerCase())
    .filter((address) => emailRegex.test(address)),
)];

module.exports = {
  LATE_SACRAMENTS,
  LATE_SACRAMENT_GRADES,
  LATE_SACRAMENT_BAPTIZED,
  LATE_SACRAMENT_PRIOR_FORMATION,
  LATE_SACRAMENT_AVAILABILITY,
  LATE_SACRAMENT_STATUSES,
  MAX_LATE_SACRAMENT_CHILDREN,
  parseLateSacramentInterest,
  getLateSacramentNotificationRecipients,
};
