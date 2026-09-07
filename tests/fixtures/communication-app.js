// Isolated UI/route fixture. Never loads .env, app.js, MySQL, or the real mailer.
const express = require('express');
const session = require('express-session');
const path = require('path');
const { createCommunications, canRead } = require('../../communications');

function fixture() {
  const users = [
    { id: 1, role: 'user', full_name: 'Maria Lopez', email: 'maria@example.test', is_active: 1 },
    { id: 2, role: 'catechist', full_name: 'Anna Thomas', email: 'anna@example.test', is_active: 1 },
    { id: 3, role: 'user', full_name: 'James Smith', email: 'james@example.test', is_active: 1 },
    { id: 4, role: 'catechist', full_name: 'Other Catechist', email: 'other@example.test', is_active: 1 },
    { id: 5, role: 'admin', full_name: 'Parish Office', email: 'office@example.test', is_active: 1 },
  ];
  const groups = [{ id: 10, label: 'First Holy Communion — Sunday 9:00 AM', time: 'Sunday 9:00 AM', room: 'Parish Hall',
    teachers: [users[1]], families: [{ id: 1, name: 'Maria Lopez', members: ['Sofia Lopez', 'Mateo Lopez'], remind: true }] }];
  const conversations = [];
  const messages = [];
  const reads = new Map();
  const preferences = new Map();
  const settings = new Map();
  const jobs = [];
  const sessions = [{ session_date: '2026-09-13', description: 'Bring your workbook.' }];
  const sent = [];
  const store = {
    users: async () => users.filter((user) => user.is_active && user.account_status !== 'deleted'),
    preferences: async (id) => preferences.get(id) || { class_reminders: 1, message_emails: 1 },
    savePreferences: async (id, r, m) => preferences.set(id, { class_reminders: Number(r), message_emails: Number(m) }),
    settings: async (id) => settings.get(id) || { enabled: 0, days_before: 1, send_hour: 18 },
    saveSettings: async (id, value) => settings.set(id, value),
    sessions: async () => sessions,
    reminderLog: async () => [],
    list: async (user, classId) => conversations.filter((item) => !classId || item.class_id === classId).map((item) => ({ ...item,
      parent_name: users.find((u) => u.id === item.parent_id)?.full_name,
      unread: messages.filter((m) => m.conversation_id === item.id && m.sender_id !== user.id && m.id > (reads.get(`${item.id}:${user.id}`) || 0)).length,
      preview: messages.filter((m) => m.conversation_id === item.id).at(-1)?.body || '',
    })),
    unreadCount: async (user) => (await store.list(user)).filter((item) => canRead(user, item, groups.find((g) => g.id === item.class_id)))
      .reduce((n, item) => n + item.unread, 0),
    conversation: async (id) => (await store.list(users[0])).find((item) => item.id === id),
    messages: async (id, before) => messages.filter((item) => item.conversation_id === id && item.id < before).slice(-60),
    markRead: async (id, userId, messageId) => reads.set(`${id}:${userId}`, Math.max(reads.get(`${id}:${userId}`) || 0, messageId)),
    saveMessage: async (value) => {
      let conversation = conversations.find((item) => item.class_id === value.classId && item.parent_id === value.parentId);
      if (!conversation) {
        conversation = { id: conversations.length + 1, class_id: value.classId, parent_id: value.parentId };
        conversations.push(conversation);
      }
      if (messages.some((item) => item.submission_key === value.submissionKey)) return conversation.id;
      const sender = users.find((user) => user.id === value.senderId);
      const message = { id: messages.length + 1, conversation_id: conversation.id, sender_id: value.senderId,
        body: value.body, sender_name: sender.full_name, created_at: new Date().toISOString(), submission_key: value.submissionKey };
      messages.push(message);
      value.recipientIds.filter((id) => id !== value.senderId).forEach((id) => jobs.push({ id: jobs.length + 1,
        kind: 'message', class_id: value.classId, user_id: id, conversation_id: conversation.id, status: 'pending', attempts: 0 }));
      return conversation.id;
    },
    enqueueReminder: async (classId, date, userId) => {
      if (!jobs.some((job) => job.class_id === classId && job.session_date === date && job.user_id === userId)) jobs.push({
        id: jobs.length + 1, kind: 'reminder', class_id: classId, session_date: date, user_id: userId, status: 'pending', attempts: 0,
      });
    },
    claimJobs: async () => {
      const job = jobs.find((item) => item.status === 'pending' && !item.retry);
      if (!job) return [];
      job.status = 'sending'; job.attempts += 1;
      return [job];
    },
    finishJob: async (job, status, error) => { job.status = status; job.last_error = error; job.retry = status === 'pending'; },
    expireAbandonedJobs: async () => {},
  };
  const options = { store, getGroups: async () => groups, sendEmail: async (mail) => { sent.push(mail); return { delivered: true }; },
    mailConfigured: () => true, baseUrl: 'http://127.0.0.1:3101', timeZone: 'America/New_York' };
  return { store, options, users, groups, conversations, messages, reads, preferences, settings, jobs, sessions, sent };
}

function createFixtureApp(data = fixture()) {
  const app = express();
  app.set('views', path.join(__dirname, '../../views'));
  app.set('view engine', 'ejs');
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(path.join(__dirname, '../../public')));
  app.use(session({ secret: 'isolated-communications-test-only', resave: false, saveUninitialized: false }));
  app.get('/__test/as/:id', (req, res) => {
    req.session.userId = Number(req.params.id);
    req.session.lang = req.query.lang === 'es' ? 'es' : 'en';
    res.redirect('/messages');
  });
  app.use((req, res, next) => {
    req.user = data.users.find((user) => user.id === req.session.userId);
    req.isAuthenticated = () => Boolean(req.user);
    req.flash = () => [];
    res.locals.user = req.user;
    res.locals.lang = req.session.lang || 'en';
    res.locals.t = (key) => ({ app_title: 'Saint Matthew Catholic Church', back_to_dashboard: 'Back to dashboard', my_account: 'My Account', language: 'Language' })[key] || key;
    res.locals.success = [];
    res.locals.error = [];
    next();
  });
  app.use('/messages', createCommunications(data.options).router);
  return { app, data };
}

if (require.main === module) {
  const { app, data } = createFixtureApp();
  data.store.saveMessage({ classId: 10, parentId: 1, senderId: 2, body: 'Welcome! Please bring your workbook to our next class. You can reply here if you have any questions.', submissionKey: 'fixture-welcome', recipientIds: [] })
    .then(() => app.listen(3101, '127.0.0.1', () => console.log('Isolated communications fixture ready')));
}

module.exports = { fixture, createFixtureApp };
