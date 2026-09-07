const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createCommunications, canRead, canWrite, reminderDue, localClock, validSettings, validateMessage } = require('../communications');
const { fixture, createFixtureApp } = require('./fixtures/communication-app');

test('private conversations require family ownership or a current staff assignment', () => {
  const f = fixture();
  const thread = { class_id: 10, parent_id: 1 };
  assert.equal(canRead(f.users[0], thread, f.groups[0]), true);
  assert.equal(canRead(f.users[1], thread, f.groups[0]), true);
  assert.equal(canRead(f.users[2], thread, f.groups[0]), false);
  assert.equal(canRead(f.users[3], thread, f.groups[0]), false);
  assert.equal(canRead(f.users[4], thread, f.groups[0]), true);
  assert.equal(canRead({ ...f.users[1], role: 'user' }, thread, f.groups[0]), false);
  f.groups[0].families = [];
  assert.equal(canRead(f.users[0], thread, f.groups[0]), true);
  assert.equal(canWrite(f.users[0], thread, f.groups[0]), false);
  f.groups[0].teachers = [];
  assert.equal(canRead(f.users[1], thread, f.groups[0]), false);
});

test('reminders use parish calendar dates across UTC midnight, DST, and year rollover', () => {
  const settings = { enabled: 1, days_before: 1, send_hour: 18 };
  assert.equal(reminderDue('2026-09-13', settings, localClock(new Date('2026-09-12T21:59:00Z'))), false);
  assert.equal(reminderDue('2026-09-13', settings, localClock(new Date('2026-09-12T22:00:00Z'))), true);
  assert.equal(reminderDue('2026-09-13', settings, localClock(new Date('2026-09-13T01:00:00Z'))), true);
  assert.equal(reminderDue('2026-09-13', settings, localClock(new Date('2026-09-13T04:00:00Z'))), false);
  assert.equal(reminderDue('2026-03-09', settings, localClock(new Date('2026-03-08T22:00:00Z'))), true);
  assert.equal(reminderDue('2026-11-02', settings, localClock(new Date('2026-11-01T23:00:00Z'))), true);
  assert.equal(reminderDue('2027-01-01', settings, localClock(new Date('2026-12-31T23:00:00Z'))), true);
  assert.equal(reminderDue('2026-09-13', { ...settings, enabled: 0 }, { date: '2026-09-12', hour: 18 }), false);
});

test('message and settings validation rejects empty bodies, oversized messages and invalid schedules', () => {
  for (const value of ['', '  ', {}, 'x'.repeat(5001)]) assert.equal(validateMessage(value), false);
  assert.equal(validateMessage('Hello!'), true);
  assert.equal(validSettings({ days_before: '1', send_hour: '18' }), true);
  for (const value of [{ days_before: '0', send_hour: '18' }, { days_before: '1', send_hour: '24' }, { days_before: '1', send_hour: '1.5' }]) assert.equal(validSettings(value), false);
});

test('worker sends one reminder per family, honors opt-out, and does not resend on the next tick', async () => {
  const f = fixture();
  f.settings.set(10, { enabled: 1, days_before: 1, send_hour: 18 });
  const service = createCommunications(f.options);
  await service.tick(new Date('2026-09-12T21:59:00Z'));
  assert.equal(f.sent.length, 0);
  await service.tick(new Date('2026-09-12T22:00:00Z'));
  await service.tick(new Date('2026-09-12T22:01:00Z'));
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].to, 'maria@example.test');
  assert.match(f.sent[0].message, /2026-09-13/);
  assert.match(f.sent[0].message, /Parish Hall/);
  assert.equal(f.jobs[0].status, 'sent');
  f.preferences.set(1, { class_reminders: 0, message_emails: 1 });
  f.sessions.push({ session_date: '2026-09-20', description: '' });
  await service.tick(new Date('2026-09-19T22:00:00Z'));
  assert.equal(f.sent.length, 1);
});

test('queued reminders are cancelled after schedule removal, withdrawal, opt-out or window expiry', async () => {
  for (const mutation of ['session', 'family', 'preferences', 'late']) {
    const f = fixture();
    f.settings.set(10, { enabled: 1, days_before: 1, send_hour: 18 });
    await f.store.enqueueReminder(10, '2026-09-13', 1);
    if (mutation === 'session') f.sessions.length = 0;
    if (mutation === 'family') f.groups[0].families.length = 0;
    if (mutation === 'preferences') f.preferences.set(1, { class_reminders: 0 });
    await createCommunications(f.options).tick(new Date(mutation === 'late' ? '2026-09-13T12:00:00Z' : '2026-09-12T22:00:00Z'));
    assert.equal(f.sent.length, 0, mutation);
    assert.equal(f.jobs[0].status, 'skipped', mutation);
  }
});

test('failed SMTP delivery stays retryable and never falsely reports sent', async () => {
  const f = fixture();
  f.settings.set(10, { enabled: 1, days_before: 1, send_hour: 18 });
  f.options.sendEmail = async () => ({ delivered: true, rejected: ['maria@example.test'] });
  await createCommunications(f.options).tick(new Date('2026-09-12T22:00:00Z'));
  assert.equal(f.jobs[0].status, 'pending');
  assert.equal(f.jobs[0].attempts, 1);
});

test('message email contains a secure conversation link; removed teachers cannot receive queued emails', async () => {
  const f = fixture();
  await f.store.saveMessage({ classId: 10, parentId: 1, senderId: 1, body: 'Private family detail', submissionKey: crypto.randomUUID(), recipientIds: [2] });
  await createCommunications(f.options).tick();
  assert.equal(f.sent.length, 1);
  assert.match(f.sent[0].message, /\/messages\/1/);
  assert.doesNotMatch(f.sent[0].message, /Private family detail/);
  await f.store.saveMessage({ classId: 10, parentId: 1, senderId: 1, body: 'Another private detail', submissionKey: crypto.randomUUID(), recipientIds: [2] });
  f.groups[0].teachers = [];
  await createCommunications(f.options).tick();
  assert.equal(f.sent.length, 1);
  assert.equal(f.jobs[1].status, 'skipped');
});

test('a sole teacher messaging as their own family notifies an admin, not no one', async (t) => {
  const data = fixture();
  // Anna (id 2) is the class's only teacher; give her a second identity as a family in
  // that same class (e.g. her own child is enrolled there) and have her post as that
  // family. With no other teacher to notify, an admin must be notified instead.
  data.groups[0].families.push({ id: 2, name: 'Anna Thomas', members: ['Anna Jr.'], remind: true });
  const { app } = createFixtureApp(data);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const loginResponse = await fetch(`${base}/__test/as/2`, { redirect: 'manual' });
  const cookie = loginResponse.headers.get('set-cookie').split(';')[0];
  const html = await (await fetch(`${base}/messages`, { headers: { cookie } })).text();
  const csrf = /name="_csrf" value="([^"]+)"/.exec(html)[1];
  const response = await fetch(`${base}/messages/new`, {
    method: 'POST', headers: { cookie }, redirect: 'manual',
    body: new URLSearchParams({ _csrf: csrf, submission_key: crypto.randomUUID(), family_class: '10:2', message: 'Can Anna Jr. stay after class?' }),
  });
  assert.equal(response.status, 302);
  assert.equal(data.jobs.length, 1);
  assert.equal(data.jobs[0].user_id, 5);
});

test('worker pauses without email configuration', async () => {
  const f = fixture();
  f.settings.set(10, { enabled: 1, days_before: 1, send_hour: 18 });
  f.options.mailConfigured = () => false;
  await createCommunications(f.options).tick(new Date('2026-09-12T22:00:00Z'));
  assert.equal(f.sent.length, 0);
  assert.equal(f.jobs.length, 0);
});

test('HTTP routes support parent/catechist replies, unread state, CSRF and cross-family denial', async (t) => {
  const { app, data } = createFixtureApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const anonymous = await fetch(`${base}/messages`, { redirect: 'manual' });
  assert.equal(anonymous.status, 302);
  assert.equal(anonymous.headers.get('location'), '/login');
  async function login(id) {
    const response = await fetch(`${base}/__test/as/${id}`, { redirect: 'manual' });
    return response.headers.get('set-cookie').split(';')[0];
  }
  async function page(cookie, path = '/messages') {
    return fetch(`${base}${path}`, { headers: { cookie }, redirect: 'manual' });
  }
  async function post(cookie, path, values) {
    return fetch(`${base}${path}`, { method: 'POST', headers: { cookie }, body: new URLSearchParams(values), redirect: 'manual' });
  }
  const parent = await login(1);
  const html = await (await page(parent)).text();
  const csrf = /name="_csrf" value="([^"]+)"/.exec(html)[1];
  const submission = /name="submission_key" value="([^"]+)"/.exec(html)[1];
  assert.equal((await post(parent, '/messages/new', { family_class: '10:1', message: 'No token' })).status, 403);
  assert.equal((await post(parent, '/messages/new', { _csrf: csrf, submission_key: submission, family_class: '10:3', message: 'Wrong family' })).status, 403);
  const form = { _csrf: csrf, submission_key: submission, family_class: '10:1', message: 'Can Sofia bring her workbook? <script>alert(1)</script>' };
  assert.equal((await post(parent, '/messages/new', form)).status, 302);
  assert.equal((await post(parent, '/messages/new', form)).status, 302);
  assert.equal(data.messages.length, 1);
  const parentConversation = await (await page(parent, '/messages/1')).text();
  assert.match(parentConversation, /&lt;script&gt;/);
  assert.doesNotMatch(parentConversation, /<script>alert/);
  const otherParent = await login(3);
  assert.equal((await page(otherParent, '/messages/1')).status, 404);
  assert.doesNotMatch(await (await page(otherParent)).text(), /Can Sofia/);
  const otherTeacher = await login(4);
  assert.equal((await page(otherTeacher, '/messages/1')).status, 404);
  assert.equal((await page(parent, '/messages/classes/10/reminders')).status, 404);
  const teacher = await login(2);
  assert.match(await (await page(teacher)).text(), /1 unread/);
  const conversation = await (await page(teacher, '/messages/1')).text();
  assert.equal(await data.store.unreadCount(data.users[1]), 0);
  const teacherCsrf = /name="_csrf" value="([^"]+)"/.exec(conversation)[1];
  assert.equal((await post(teacher, '/messages/1', { _csrf: teacherCsrf, submission_key: crypto.randomUUID(), message: 'Yes, please bring it.' })).status, 302);
  assert.equal(await data.store.unreadCount(data.users[0]), 1);
  assert.equal((await page(teacher, '/messages/classes/10/reminders')).status, 200);
  assert.equal((await post(teacher, '/messages/classes/10/reminders', { _csrf: teacherCsrf, enabled: '1', days_before: '1', send_hour: '18' })).status, 302);
  assert.equal(data.settings.get(10).enabled, true);
});
