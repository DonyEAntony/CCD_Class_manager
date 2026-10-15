const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_LATE_SACRAMENT_CHILDREN,
  parseLateSacramentInterest,
  getLateSacramentNotificationRecipients,
} = require('../late-sacrament-interest');
const { buildLateSacramentInterestEmailContent } = require('../mailer');

const today = new Date('2026-10-15T12:00:00Z');
const child = {
  first_name: ' Ana ',
  last_name: 'Lopez',
  date_of_birth: '2018-04-02',
  grade: '2',
  sacraments: ['first_reconciliation', 'first_communion'],
  baptized: 'yes',
  baptism_parish: 'St. Anne',
  prior_formation: 'one_year',
};
const valid = {
  parent_name: '  Maria Lopez ',
  email: ' Maria@Example.COM ',
  phone: '407-555-0123',
  parishioner: 'yes',
  children: [child],
};
const parse = (body) => parseLateSacramentInterest(body, today);

test('a complete submission is trimmed and normalised', () => {
  const { spam, errors, values } = parse(valid);
  assert.equal(spam, false);
  assert.deepEqual(errors, []);
  assert.equal(values.parentName, 'Maria Lopez');
  assert.equal(values.email, 'maria@example.com');
  assert.deepEqual(values.availability, []);
  assert.equal(values.children.length, 1);
  assert.equal(values.children[0].firstName, 'Ana');
  assert.deepEqual(values.children[0].sacraments, ['first_reconciliation', 'first_communion']);
  assert.equal(values.children[0].priorFormation, 'one_year');
});

test('children posted with sparse indices (object, not array) are all read', () => {
  const { errors, values } = parse({ ...valid, children: { 0: child, 3: { ...child, first_name: 'Luis', sacraments: 'confirmation', grade: '8', date_of_birth: '2012-01-10' } } });
  assert.deepEqual(errors, []);
  assert.deepEqual(values.children.map((c) => c.firstName), ['Ana', 'Luis']);
  assert.deepEqual(values.children[1].sacraments, ['confirmation']);
});

test('a fully blank child block is ignored rather than reported', () => {
  const { errors, values } = parse({ ...valid, children: [child, { first_name: '', last_name: '', baptism_parish: '' }] });
  assert.deepEqual(errors, []);
  assert.equal(values.children.length, 1);
});

test('at least one child is required', () => {
  assert.deepEqual(parse({ ...valid, children: [] }).errors, ['late_sacrament_err_no_children']);
  assert.deepEqual(parse({ ...valid, children: undefined }).errors, ['late_sacrament_err_no_children']);
});

test('each kind of child problem is reported once, however many children have it', () => {
  const bad = { ...child, last_name: '', sacraments: [] };
  assert.deepEqual(parse({ ...valid, children: [bad, bad] }).errors, ['late_sacrament_err_child_required', 'late_sacrament_err_child_sacraments']);
});

test('unknown grades, sacraments and baptism answers are dropped', () => {
  const { errors, values } = parse({ ...valid, children: [{ ...child, grade: '13', sacraments: ['ordination', 'confirmation'], baptized: 'maybe' }] });
  assert.deepEqual(values.children[0].sacraments, ['confirmation']);
  assert.equal(values.children[0].grade, '');
  assert.deepEqual(errors, ['late_sacrament_err_child_required']);
});

test('dates of birth must be real and within school age', () => {
  for (const dob of ['2018-02-30', '04/02/2018', '1985-04-02', '2025-01-01', '2027-01-01']) {
    assert.deepEqual(parse({ ...valid, children: [{ ...child, date_of_birth: dob }] }).errors, ['late_sacrament_err_child_dob'], dob);
  }
});

test('contact details are validated like the other public forms', () => {
  assert.deepEqual(parse({ ...valid, email: '', phone: '' }).errors, ['late_sacrament_err_required']);
  assert.deepEqual(parse({ ...valid, email: 'nope', phone: '123' }).errors, ['late_sacrament_err_email', 'late_sacrament_err_phone']);
  assert.deepEqual(parse({ ...valid, parishioner: 'maybe' }).errors, ['late_sacrament_err_parishioner']);
});

test('no more than the maximum number of children is kept', () => {
  const many = Array.from({ length: MAX_LATE_SACRAMENT_CHILDREN + 3 }, () => child);
  assert.equal(parse({ ...valid, children: many }).values.children.length, MAX_LATE_SACRAMENT_CHILDREN);
});

test('a filled honeypot marks the submission as spam', () => {
  assert.equal(parse({ ...valid, website: 'http://spam.example' }).spam, true);
});

test('notification recipients fall back to ADMIN_EMAIL and drop invalid entries', () => {
  assert.deepEqual(getLateSacramentNotificationRecipients({ SACRAMENT_INTEREST_NOTIFY_EMAIL: 'a@x.org; bad, B@x.org', ADMIN_EMAIL: 'admin@x.org' }), ['a@x.org', 'b@x.org']);
  assert.deepEqual(getLateSacramentNotificationRecipients({ ADMIN_EMAIL: 'admin@x.org' }), ['admin@x.org']);
  assert.deepEqual(getLateSacramentNotificationRecipients({}), []);
});

test('notification email lists the family and each child, escaped', () => {
  const { subject, html } = buildLateSacramentInterestEmailContent({
    parentName: 'Maria <b>Lopez</b>\r\nBcc: x@y.z',
    email: 'maria@example.com',
    phone: '407-555-0123',
    parishioner: 'Yes',
    availability: ['Sundays'],
    children: [
      { name: 'Ana Lopez', dateOfBirth: '2018-04-02', grade: '2nd grade', sacraments: ['First Reconciliation', 'First Holy Communion'], baptized: 'Yes', baptismParish: 'St. Anne' },
      { name: 'Luis Lopez', dateOfBirth: '2012-01-10', grade: '8th grade', sacraments: ['Confirmation'], baptized: 'Not sure' },
    ],
    adminUrl: 'https://ccd.example.org/admin/sacrament-interest',
  });
  assert.ok(!/[\r\n]/.test(subject));
  assert.ok(subject.endsWith('(2 children)'));
  assert.ok(!html.includes('<b>Lopez</b>'));
  for (const expected of ['Ana Lopez', 'First Reconciliation, First Holy Communion', 'St. Anne', 'Luis Lopez', 'Confirmation', 'Not sure', 'Sundays', 'href="https://ccd.example.org/admin/sacrament-interest"']) {
    assert.ok(html.includes(expected), `missing: ${expected}`);
  }
  assert.ok(!html.includes('Notes'));
});
