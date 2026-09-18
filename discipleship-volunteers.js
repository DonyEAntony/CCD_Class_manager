// Discipleship Team volunteer sign-up: the fixed option lists the form offers and the
// validation of a submission. Kept free of Express/DB so it can be unit-tested; app.js
// turns the returned error keys into translated messages.

// Slugs are what get stored (comma-separated for the multi-select groups) and what the
// views translate as `volunteer_role_<slug>`, `volunteer_availability_<slug>`,
// `volunteer_growth_<slug>`, `volunteer_experience_<slug>` and `volunteer_marital_<slug>`.
const VOLUNTEER_ROLES = ['catechist', 'classroom_assistant', 'family_faith_leader', 'sacramental_prep', 'events_hospitality', 'not_sure'];
const VOLUNTEER_AVAILABILITY = ['sunday', 'weekday_daytime', 'weekday_evening', 'special_events'];
const VOLUNTEER_GROWTH_AREAS = ['scripture', 'catholic_faith', 'prayer', 'evangelization', 'fellowship'];
// Prior faith-formation background. `none` is an explicit answer so a blank group can be
// told apart from "hasn't answered".
const VOLUNTEER_EXPERIENCE_TYPES = ['family_catechesis', 'good_shepherd', 'classroom_catechist', 'youth_ministry', 'adult_formation', 'none'];
// `prefer_to_discuss` lets someone answer without putting a sensitive detail in a web
// form, and leaves the conversation to the team.
const VOLUNTEER_MARITAL_STATUSES = ['single', 'married_church', 'married_civil', 'separated', 'divorced', 'divorced_annulled', 'widowed', 'prefer_to_discuss'];
const VOLUNTEER_STATUSES = ['new', 'contacted', 'serving', 'inactive'];

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phoneRegex = /^\d{3}[-.\s]?\d{3}[-.\s]?\d{4}$/;

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

// Checkbox groups arrive as a string (one box), an array (several) or nothing. Anything
// not in the allowed list is dropped, which also discards the objects `extended` body
// parsing can produce from a crafted field name.
const pickAllowed = (value, allowed) => [...new Set([].concat(value || []))].filter((item) => allowed.includes(item));

// Returns { spam, values, errors }. `errors` holds translation keys. `spam` is set when
// the hidden honeypot field was filled in — a person never sees that field, so a value
// means a bot; the caller should answer as if it succeeded and store nothing.
const parseVolunteerSignup = (body = {}) => {
  const values = {
    fullName: text(body.full_name, 255),
    email: text(body.email, 255).toLowerCase(),
    phone: text(body.phone, 50),
    maritalStatus: VOLUNTEER_MARITAL_STATUSES.includes(body.marital_status) ? body.marital_status : '',
    roles: pickAllowed(body.roles, VOLUNTEER_ROLES),
    availability: pickAllowed(body.availability, VOLUNTEER_AVAILABILITY),
    experienceTypes: pickAllowed(body.experience_types, VOLUNTEER_EXPERIENCE_TYPES),
    experienceDetails: text(body.experience_details, 2000),
    growthAreas: pickAllowed(body.growth_areas, VOLUNTEER_GROWTH_AREAS),
    notes: text(body.notes, 2000),
  };

  if (text(body.website, 255)) return { spam: true, values, errors: [] };

  const errors = [];
  if (!values.fullName || !values.email || !values.phone) errors.push('volunteer_err_required');
  else {
    if (!emailRegex.test(values.email)) errors.push('volunteer_err_email');
    if (!phoneRegex.test(values.phone)) errors.push('volunteer_err_phone');
  }
  if (!values.maritalStatus) errors.push('volunteer_err_marital');
  if (!values.roles.length) errors.push('volunteer_err_roles');
  if (!values.experienceTypes.length) errors.push('volunteer_err_experience');

  return { spam: false, values, errors };
};

// Who is told about a new sign-up: VOLUNTEER_NOTIFY_EMAIL (one address or a comma/
// semicolon-separated list), falling back to the app's ADMIN_EMAIL. Entries that aren't
// valid addresses are dropped, so a typo in one doesn't stop the others receiving it.
const getVolunteerNotificationRecipients = (env = process.env) => [...new Set(
  `${env.VOLUNTEER_NOTIFY_EMAIL || env.ADMIN_EMAIL || ''}`
    .split(/[,;]/)
    .map((address) => address.trim().toLowerCase())
    .filter((address) => emailRegex.test(address)),
)];

// Stored lists are comma-separated slugs; unknown slugs (an option removed later) are
// skipped rather than shown raw.
const splitList = (stored, allowed) => (stored ? `${stored}`.split(',').filter((item) => allowed.includes(item)) : []);

module.exports = {
  VOLUNTEER_ROLES,
  VOLUNTEER_AVAILABILITY,
  VOLUNTEER_GROWTH_AREAS,
  VOLUNTEER_EXPERIENCE_TYPES,
  VOLUNTEER_MARITAL_STATUSES,
  VOLUNTEER_STATUSES,
  parseVolunteerSignup,
  getVolunteerNotificationRecipients,
  splitList,
};
