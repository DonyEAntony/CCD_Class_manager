const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  VOLUNTEER_ROLES,
  parseVolunteerSignup,
  getVolunteerNotificationRecipients,
  splitList,
} = require('../discipleship-volunteers');

const valid = {
  full_name: '  Maria Lopez ',
  email: ' Maria@Example.COM ',
  phone: '407-555-0123',
  marital_status: 'married_church',
  roles: ['catechist', 'events_hospitality'],
  experience_types: ['family_catechesis', 'good_shepherd'],
};

test('a complete submission is trimmed and normalised', () => {
  const { spam, errors, values } = parseVolunteerSignup(valid);
  assert.equal(spam, false);
  assert.deepEqual(errors, []);
  assert.equal(values.fullName, 'Maria Lopez');
  assert.equal(values.email, 'maria@example.com');
  assert.equal(values.maritalStatus, 'married_church');
  assert.deepEqual(values.roles, ['catechist', 'events_hospitality']);
  assert.deepEqual(values.experienceTypes, ['family_catechesis', 'good_shepherd']);
  assert.deepEqual(values.availability, []);
  assert.deepEqual(values.growthAreas, []);
});

test('a single ticked checkbox (string, not array) is accepted', () => {
  const { errors, values } = parseVolunteerSignup({
    ...valid, roles: 'not_sure', experience_types: 'good_shepherd', availability: 'sunday', growth_areas: 'prayer',
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(values.roles, ['not_sure']);
  assert.deepEqual(values.experienceTypes, ['good_shepherd']);
  assert.deepEqual(values.availability, ['sunday']);
  assert.deepEqual(values.growthAreas, ['prayer']);
});

test('missing contact details are reported once, without also validating their format', () => {
  const { errors } = parseVolunteerSignup({ ...valid, email: '', phone: '' });
  assert.deepEqual(errors, ['volunteer_err_required']);
});

test('bad email and phone formats are each reported', () => {
  const { errors } = parseVolunteerSignup({ ...valid, email: 'not-an-email', phone: '12345' });
  assert.deepEqual(errors, ['volunteer_err_email', 'volunteer_err_phone']);
});

test('the accepted phone formats match the rest of the app', () => {
  for (const phone of ['407-555-0123', '407.555.0123', '407 555 0123', '4075550123']) {
    assert.deepEqual(parseVolunteerSignup({ ...valid, phone }).errors, [], phone);
  }
});

test('marital status is required and must be one of the offered options', () => {
  assert.deepEqual(parseVolunteerSignup({ ...valid, marital_status: undefined }).errors, ['volunteer_err_marital']);
  assert.deepEqual(parseVolunteerSignup({ ...valid, marital_status: 'complicated' }).errors, ['volunteer_err_marital']);
  assert.deepEqual(parseVolunteerSignup({ ...valid, marital_status: ['single'] }).errors, ['volunteer_err_marital']);
});

test('"prefer to discuss" is a valid marital-status answer', () => {
  const { errors, values } = parseVolunteerSignup({ ...valid, marital_status: 'prefer_to_discuss' });
  assert.deepEqual(errors, []);
  assert.equal(values.maritalStatus, 'prefer_to_discuss');
});

test('at least one way to help is required', () => {
  assert.deepEqual(parseVolunteerSignup({ ...valid, roles: undefined }).errors, ['volunteer_err_roles']);
  assert.deepEqual(parseVolunteerSignup({ ...valid, roles: [] }).errors, ['volunteer_err_roles']);
});

test('prior experience must be answered, and "none" counts as an answer', () => {
  assert.deepEqual(parseVolunteerSignup({ ...valid, experience_types: undefined }).errors, ['volunteer_err_experience']);
  assert.deepEqual(parseVolunteerSignup({ ...valid, experience_types: ['made_up'] }).errors, ['volunteer_err_experience']);
  assert.deepEqual(parseVolunteerSignup({ ...valid, experience_types: 'none' }).errors, []);
});

test('every problem on the form is reported together', () => {
  const { errors } = parseVolunteerSignup({});
  assert.deepEqual(errors, ['volunteer_err_required', 'volunteer_err_marital', 'volunteer_err_roles', 'volunteer_err_experience']);
});

test('values outside the offered lists are dropped, including crafted non-string input', () => {
  const { errors, values } = parseVolunteerSignup({
    ...valid,
    roles: ['catechist', 'bishop', 'catechist', { $ne: 'x' }, ['nested']],
    availability: ['sunday', 'midnight'],
    growth_areas: 'not-a-real-area',
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(values.roles, ['catechist']);
  assert.deepEqual(values.availability, ['sunday']);
  assert.deepEqual(values.growthAreas, []);
});

test('a role that is not on the list cannot satisfy the required-role check', () => {
  assert.deepEqual(parseVolunteerSignup({ ...valid, roles: ['bishop'] }).errors, ['volunteer_err_roles']);
});

test('non-string text fields are ignored and long text is capped', () => {
  const { values } = parseVolunteerSignup({
    ...valid, experience_details: ['a', 'b'], notes: 'x'.repeat(5000), full_name: 'y'.repeat(400),
  });
  assert.equal(values.experienceDetails, '');
  assert.equal(values.notes.length, 2000);
  assert.equal(values.fullName.length, 255);
});

test('a filled honeypot marks the submission as spam and skips validation', () => {
  const result = parseVolunteerSignup({ website: 'http://spam.example' });
  assert.equal(result.spam, true);
  assert.deepEqual(result.errors, []);
});

test('an empty honeypot is not spam', () => {
  assert.equal(parseVolunteerSignup({ ...valid, website: '   ' }).spam, false);
});

test('stored lists split into known slugs only', () => {
  assert.deepEqual(splitList('catechist,retired_role,not_sure', VOLUNTEER_ROLES), ['catechist', 'not_sure']);
  assert.deepEqual(splitList(null, VOLUNTEER_ROLES), []);
  assert.deepEqual(splitList('', VOLUNTEER_ROLES), []);
});

test('notification recipients: VOLUNTEER_NOTIFY_EMAIL wins over ADMIN_EMAIL and may be a list', () => {
  const env = { VOLUNTEER_NOTIFY_EMAIL: ' Office@Example.org; team@example.org ,office@example.org', ADMIN_EMAIL: 'admin@example.org' };
  assert.deepEqual(getVolunteerNotificationRecipients(env), ['office@example.org', 'team@example.org']);
});

test('notification recipients: falls back to ADMIN_EMAIL when the notify address is unset or blank', () => {
  assert.deepEqual(getVolunteerNotificationRecipients({ ADMIN_EMAIL: 'admin@example.org' }), ['admin@example.org']);
  assert.deepEqual(getVolunteerNotificationRecipients({ VOLUNTEER_NOTIFY_EMAIL: '', ADMIN_EMAIL: 'admin@example.org' }), ['admin@example.org']);
});

test('notification recipients: invalid entries are dropped and none configured means none', () => {
  assert.deepEqual(getVolunteerNotificationRecipients({ VOLUNTEER_NOTIFY_EMAIL: 'oops, ok@example.org, a b@c.d' }), ['ok@example.org']);
  assert.deepEqual(getVolunteerNotificationRecipients({}), []);
});
