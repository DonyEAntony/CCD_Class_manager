const crypto = require('crypto');
const express = require('express');
const { requireAuth } = require('./middleware');
const { staffRoles } = require('./communications-store');

const TIME_ZONE = process.env.CLASS_REMINDER_TIMEZONE || 'America/New_York';
const isStaff = (user) => staffRoles.includes(user.role);
const teaches = (user, group) => isStaff(user) && group?.teachers.some((teacher) => teacher.id === user.id);
const canManage = (user, group) => Boolean(group && (user.role === 'admin' || teaches(user, group)));
const canRead = (user, conversation, group) => Boolean(conversation && group
  && (conversation.parent_id === user.id || canManage(user, group)));
const canWrite = (user, conversation, group) => canRead(user, conversation, group)
  && group.families.some((family) => family.id === conversation.parent_id);
const positiveId = (value) => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0
  ? Number(value) : null;

function localClock(now, timeZone = TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { date: `${values.year}-${values.month}-${values.day}`, hour: Number(values.hour) };
}

function reminderDue(sessionDate, settings, clock) {
  if (!Number(settings.enabled) || !/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) return false;
  const sendDate = new Date(`${sessionDate}T12:00:00Z`);
  sendDate.setUTCDate(sendDate.getUTCDate() - Number(settings.days_before));
  return sendDate.toISOString().slice(0, 10) === clock.date && clock.hour >= Number(settings.send_hour);
}

function validateMessage(body) {
  return typeof body === 'string' && body.trim().length > 0 && body.trim().length <= 5000;
}

function validSettings(body) {
  return ['1', '2', '7'].includes(String(body.days_before))
    && /^(?:[0-9]|1[0-9]|2[0-3])$/.test(String(body.send_hour));
}

function csrf(req, res, next) {
  if (!req.session.communicationCsrf) req.session.communicationCsrf = crypto.randomBytes(32).toString('hex');
  res.locals.communicationCsrf = req.session.communicationCsrf;
  if (req.method !== 'GET') {
    const token = typeof req.body._csrf === 'string' ? req.body._csrf : '';
    const expected = req.session.communicationCsrf;
    if (!/^[a-f0-9]{64}$/.test(token) || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
      return res.status(403).send('This form has expired. Refresh the page and try again.');
    }
  }
  next();
}

function createCommunications({ store, getGroups, sendEmail, mailConfigured, timeZone = TIME_ZONE, baseUrl = process.env.APP_BASE_URL || '' }) {
  // Validate at startup: an invalid IANA timezone must not silently change send times.
  localClock(new Date(), timeZone);
  const configured = () => Boolean(mailConfigured() && /^https?:\/\//i.test(baseUrl));
  const url = (path) => `${baseUrl.replace(/\/$/, '')}${path}`;
  const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
  const router = express.Router();
  router.use(requireAuth, csrf);
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.locals.comm = (en, es) => res.locals.lang === 'es' ? es : en;
    res.locals.timeZone = timeZone;
    res.locals.mailReady = configured();
    res.locals.deliveryPaused = process.env.COMMUNICATION_WORKER_ENABLED === 'false';
    next();
  });

  router.get('/', asyncRoute(async (req, res) => {
    const groups = await getGroups();
    const filter = positiveId(req.query.class);
    const choices = groups.flatMap((group) => group.families
      .filter((family) => (!filter || group.id === filter) && (family.id === req.user.id || canManage(req.user, group)))
      .map((family) => ({ value: `${group.id}:${family.id}`, label: `${group.label} — ${family.name} (${family.members.join(', ')})` })));
    const rows = await store.list(req.user, filter);
    const conversations = rows.filter((row) => canRead(req.user, row, groups.find((group) => group.id === row.class_id)))
      .map((row) => ({ ...row, classLabel: groups.find((group) => group.id === row.class_id).label }));
    res.render('messages', { conversations, choices, submissionKey: crypto.randomUUID(),
      preferences: await store.preferences(req.user.id), selectedClass: filter });
  }));

  router.post('/preferences', asyncRoute(async (req, res) => {
    await store.savePreferences(req.user.id, req.body.class_reminders === '1', req.body.message_emails === '1');
    req.flash('success', res.locals.comm('Email preferences saved.', 'Preferencias de correo guardadas.'));
    res.redirect('/messages');
  }));

  async function submit(req, res, conversation, group) {
    if (!canWrite(req.user, conversation, group)) return res.status(403).send('This conversation is not available for messaging.');
    if (!validateMessage(req.body.message) || typeof req.body.submission_key !== 'string'
      || !/^[a-f0-9-]{36}$/.test(req.body.submission_key)) {
      return res.status(400).send('Enter a message of 1–5,000 characters using the message form.');
    }
    const family = group.families.find((item) => item.id === conversation.parent_id);
    // The sender is excluded before checking whether anyone is left to notify — a class's
    // sole teacher who is also its family (e.g. a catechist with a child in their own
    // class) would otherwise count as one non-empty recipient here, skip the admin
    // fallback below, and then get silently dropped as "sender === recipient" once
    // saveMessage builds the outbox, notifying no one at all.
    const recipients = (req.user.id === family.id ? group.teachers : [family]).filter((user) => user.id !== req.user.id);
    const admins = recipients.length ? [] : (await store.users()).filter((user) => user.role === 'admin' && user.id !== req.user.id);
    const id = await store.saveMessage({ classId: group.id, parentId: family.id, senderId: req.user.id,
      body: req.body.message.trim(), submissionKey: req.body.submission_key,
      recipientIds: [...recipients, ...admins].map((user) => user.id) });
    req.flash('success', res.locals.comm('Message saved. Replies appear in this conversation.', 'Mensaje guardado. Las respuestas aparecen en esta conversación.'));
    return res.redirect(`/messages/${id}`);
  }

  router.post('/new', asyncRoute(async (req, res) => {
    const value = typeof req.body.family_class === 'string' ? req.body.family_class : '';
    const [classId, parentId] = value.split(':').map(positiveId);
    const group = (await getGroups()).find((item) => item.id === classId);
    return submit(req, res, { class_id: classId, parent_id: parentId }, group);
  }));

  router.get('/classes/:classId/reminders', asyncRoute(async (req, res) => {
    const group = (await getGroups()).find((item) => item.id === positiveId(req.params.classId));
    if (!canManage(req.user, group)) return res.status(404).send('Class not found.');
    const clock = localClock(new Date(), timeZone);
    res.render('class-reminders', { group, settings: await store.settings(group.id),
      sessions: (await store.sessions(group.id)).filter((session) => session.session_date >= clock.date).slice(0, 8),
      log: await store.reminderLog(group.id) });
  }));

  router.post('/classes/:classId/reminders', asyncRoute(async (req, res) => {
    const group = (await getGroups()).find((item) => item.id === positiveId(req.params.classId));
    if (!canManage(req.user, group)) return res.status(404).send('Class not found.');
    if (!validSettings(req.body)) return res.status(400).send('Choose a valid reminder day and hour.');
    await store.saveSettings(group.id, { enabled: req.body.enabled === '1',
      days_before: Number(req.body.days_before), send_hour: Number(req.body.send_hour) });
    req.flash('success', res.locals.comm('Class reminder settings saved.', 'Recordatorios de clase guardados.'));
    res.redirect(`/messages/classes/${group.id}/reminders`);
  }));

  router.get('/:id', asyncRoute(async (req, res) => {
    const conversation = await store.conversation(positiveId(req.params.id) || 0);
    const group = (await getGroups()).find((item) => item.id === conversation?.class_id);
    if (!canRead(req.user, conversation, group)) return res.status(404).send('Conversation not found.');
    const before = positiveId(req.query.before) || 2147483647;
    const messages = await store.messages(conversation.id, before);
    if (messages.length) await store.markRead(conversation.id, req.user.id, messages[messages.length - 1].id);
    res.locals.communicationUnread = await store.unreadCount(req.user);
    res.render('conversation', { conversation, group, messages, canReply: canWrite(req.user, conversation, group),
      olderCursor: messages.length === 60 ? messages[0].id : null,
      viewingOlder: before !== 2147483647, submissionKey: crypto.randomUUID() });
  }));

  router.post('/:id', asyncRoute(async (req, res) => {
    const conversation = await store.conversation(positiveId(req.params.id) || 0);
    const group = (await getGroups()).find((item) => item.id === conversation?.class_id);
    if (!canRead(req.user, conversation, group)) return res.status(404).send('Conversation not found.');
    return submit(req, res, conversation, group);
  }));

  router.use((error, req, res, _next) => {
    console.error('[communications] Request failed:', error.code || error.name);
    res.status(500).send('Unable to complete this request. Please try again.');
  });

  let running = false;
  async function tick(now = new Date()) {
    if (running || !configured()) return;
    running = true;
    try {
      const clock = localClock(now, timeZone);
      const groups = await getGroups();
      for (const group of groups) {
        const settings = await store.settings(group.id);
        if (!Number(settings.enabled)) continue;
        for (const session of await store.sessions(group.id)) {
          if (!reminderDue(session.session_date, settings, clock)) continue;
          for (const family of group.families.filter((family) => family.remind)) {
            if (Number((await store.preferences(family.id)).class_reminders)) {
              await store.enqueueReminder(group.id, session.session_date, family.id);
            }
          }
        }
      }
      await store.expireAbandonedJobs();
      // Claim one email at a time; a large batch must not outlive its delivery lease.
      for (let index = 0; index < 50; index += 1) {
        const [job] = await store.claimJobs();
        if (!job) break;
        try {
          // Re-resolve membership and schedules before sending queued work: enrollment,
          // teacher assignments, opt-outs and cancelled sessions can change after enqueue.
          const group = (await getGroups()).find((item) => item.id === job.class_id);
          const user = (await store.users()).find((item) => item.id === job.user_id);
          const preferences = user && await store.preferences(user.id);
          let email = null;
          if (group && user && job.kind === 'reminder' && Number(preferences.class_reminders)) {
            const settings = await store.settings(group.id);
            const session = (await store.sessions(group.id)).find((item) => item.session_date === job.session_date);
            const family = group.families.find((item) => item.id === user.id && item.remind);
            if (family && session && reminderDue(job.session_date, settings, clock)) {
              email = { subject: `Class reminder: ${group.label}`,
                message: `Hello ${user.full_name || ''},\n\nYour class is scheduled for ${session.session_date}.\n${group.label}\n${group.time || ''}\n${group.room ? `Room: ${group.room}\n` : ''}${session.description || ''}\n\nView the class calendar: ${url(`/calendar/class/${group.id}`)}\n\nManage reminder emails: ${url('/messages')}\nPlease do not reply to this automated email. Use Messages in the app to contact the class team.` };
            }
          } else if (group && user && job.kind === 'message' && Number(preferences.message_emails)) {
            const conversation = await store.conversation(job.conversation_id);
            if (canRead(user, conversation, group)) {
              email = { subject: `New message: ${group.label}`,
                message: `You have a new message in Saint Matthew Faith Formation.\n\nRead and reply securely: ${url(`/messages/${job.conversation_id}`)}\n\nPlease reply in the app. Replies to this notification email are not added to the conversation.\nManage email preferences: ${url('/messages')}` };
            }
          }
          if (!email) {
            await store.finishJob(job, 'skipped', 'Preferences, membership, or schedule changed; reminder window may have passed.');
            continue;
          }
          const result = await sendEmail({ to: user.email, ...email, senderName: 'Saint Matthew Faith Formation' });
          if (!result.delivered || result.rejected?.length) throw new Error('Email was not accepted by the mail server.');
          await store.finishJob(job, 'sent');
        } catch (error) {
          // Avoid persisting SMTP diagnostics containing credentials or message content.
          await store.finishJob(job, job.attempts >= 5 ? 'failed' : 'pending', 'Email delivery failed. Automatic retry scheduled unless attempts are exhausted.');
          console.error('[communications] Email delivery failed:', error.code || error.name);
        }
      }
    } finally {
      running = false;
    }
  }

  function start() {
    if (process.env.COMMUNICATION_WORKER_ENABLED === 'false') return null;
    const run = () => tick().catch((error) => console.error('[communications] Worker failed:', error.code || error.name));
    const timer = setInterval(run, 60_000);
    timer.unref();
    run();
    return timer;
  }
  return { router, tick, start };
}

module.exports = { createCommunications, canRead, canWrite, canManage, localClock, reminderDue, validSettings, validateMessage, positiveId };
