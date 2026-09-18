const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildVolunteerNotificationEmailContent } = require('../mailer');

const full = {
  fullName: 'Maria Lopez',
  email: 'maria@example.com',
  phone: '407-555-0123',
  roles: ['Catechist', 'Family faith leader'],
  availability: ['Sundays'],
  experience: ['Family catechesis', 'Catechesis of the Good Shepherd'],
  experienceDetails: 'Good Shepherd Level I & II\n4 years at St. Anne',
  growth: ['Prayer and spiritual life'],
  notes: 'Would love a small group.',
  adminUrl: 'https://ccd.example.org/admin/catechists#volunteer-signups',
};

test('subject names the volunteer', () => {
  assert.equal(buildVolunteerNotificationEmailContent(full).subject, 'New Discipleship Team volunteer: Maria Lopez');
});

test('body carries contact details, interests, experience and growth areas', () => {
  const { html } = buildVolunteerNotificationEmailContent(full);
  for (const expected of ['Maria Lopez', 'mailto:maria@example.com', '407-555-0123', 'Catechist, Family faith leader', 'Sundays',
    'Family catechesis, Catechesis of the Good Shepherd', 'Good Shepherd Level I &amp; II<br>4 years at St. Anne', 'Prayer and spiritual life', 'Would love a small group.']) {
    assert.ok(html.includes(expected), `missing: ${expected}`);
  }
});

test('links to the admin volunteer list', () => {
  const { html } = buildVolunteerNotificationEmailContent(full);
  assert.ok(html.includes('href="https://ccd.example.org/admin/catechists#volunteer-signups"'));
});

test('marital status can never appear: it is not an accepted input, even if passed', () => {
  const { html } = buildVolunteerNotificationEmailContent({ ...full, maritalStatus: 'divorced_annulled', marital_status: 'Divorced' });
  assert.ok(!/marital|divorced|married|widowed|annul/i.test(html));
});

test('empty optional sections are left out rather than shown blank', () => {
  const { html } = buildVolunteerNotificationEmailContent({ fullName: 'Tom', email: 'tom@example.com', phone: '407-555-0199', roles: ['Not sure yet'], experience: ['No prior experience'] });
  for (const label of ['Availability', 'Experience details', 'Wants to grow in', 'Notes']) assert.ok(!html.includes(label), label);
  assert.ok(!html.includes('View volunteer sign-ups'));
});

test('hostile input is HTML-escaped and cannot break the subject line', () => {
  const { subject, html } = buildVolunteerNotificationEmailContent({
    ...full,
    fullName: 'Eve <script>alert(1)</script>\r\nBcc: victim@example.com',
    notes: '<img src=x onerror=alert(1)>',
    experienceDetails: '"><b>bold</b>',
  });
  assert.ok(!/<script|<img|<b>/.test(html));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!/[\r\n]/.test(subject));
});
