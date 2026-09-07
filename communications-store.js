const crypto = require('crypto');

const activeUserSql = "is_active = 1 AND COALESCE(account_status, 'active') <> 'deleted'";
const staffRoles = ['admin', 'catechist', 'family_faith_leader'];

function createCommunicationStore(db) {
  return {
    async users() {
      return db.prepare(`SELECT id, full_name, email, role, is_active, account_status FROM users WHERE ${activeUserSql}`).all();
    },
    async preferences(userId) {
      return await db.prepare('SELECT * FROM communication_preferences WHERE user_id = ?').get(userId)
        || { class_reminders: 1, message_emails: 1 };
    },
    async savePreferences(userId, reminders, messages) {
      await db.prepare(`INSERT INTO communication_preferences (user_id, class_reminders, message_emails)
        VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE class_reminders = VALUES(class_reminders), message_emails = VALUES(message_emails)`)
        .run(userId, reminders ? 1 : 0, messages ? 1 : 0);
    },
    async settings(classId) {
      return await db.prepare('SELECT * FROM class_reminder_settings WHERE class_id = ?').get(classId)
        || { enabled: 0, days_before: 1, send_hour: 18 };
    },
    async saveSettings(classId, settings) {
      await db.prepare(`INSERT INTO class_reminder_settings (class_id, enabled, days_before, send_hour)
        VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), days_before = VALUES(days_before), send_hour = VALUES(send_hour)`)
        .run(classId, settings.enabled ? 1 : 0, settings.days_before, settings.send_hour);
    },
    async sessions(classId) {
      return db.prepare(`SELECT DATE_FORMAT(session_date, '%Y-%m-%d') AS session_date, description
        FROM ccd_class_session_dates WHERE ccd_class_id = ? AND event_type = 'class_day' ORDER BY session_date`).all(classId);
    },
    async reminderLog(classId) {
      return db.prepare(`SELECT o.status, o.last_error, o.attempts, o.sent_at, u.full_name,
        DATE_FORMAT(o.session_date, '%Y-%m-%d') AS session_date
        FROM communication_outbox o JOIN users u ON u.id = o.user_id
        WHERE o.class_id = ? AND o.kind = 'reminder' ORDER BY o.id DESC LIMIT 30`).all(classId);
    },
    async list(user, classId = null) {
      const staff = staffRoles.includes(user.role);
      return db.prepare(`SELECT c.*, u.full_name AS parent_name,
        (SELECT body FROM family_messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) AS preview,
        (SELECT created_at FROM family_messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) AS updated_at,
        (SELECT COUNT(*) FROM family_messages m WHERE m.conversation_id = c.id AND m.sender_id <> ?
          AND m.id > COALESCE(r.last_message_id, 0)) AS unread
        FROM family_conversations c JOIN users u ON u.id = c.parent_id
        LEFT JOIN family_message_reads r ON r.conversation_id = c.id AND r.user_id = ?
        WHERE (? = 1 OR c.parent_id = ? OR (? = 1 AND EXISTS (
          SELECT 1 FROM ccd_class_catechists cc WHERE cc.ccd_class_id = c.class_id AND cc.catechist_user_id = ?)))
        AND (? IS NULL OR c.class_id = ?)
        ORDER BY COALESCE(updated_at, c.created_at) DESC, c.id DESC`)
        .all(user.id, user.id, user.role === 'admin' ? 1 : 0, user.id, staff ? 1 : 0, user.id, classId, classId);
    },
    async unreadCount(user) {
      const rows = await this.list(user);
      return rows.reduce((total, row) => total + Number(row.unread), 0);
    },
    async conversation(id) {
      return db.prepare(`SELECT c.*, u.full_name AS parent_name FROM family_conversations c
        JOIN users u ON u.id = c.parent_id WHERE c.id = ?`).get(id);
    },
    async messages(id, before = 2147483647) {
      const rows = await db.prepare(`SELECT m.*, DATE_FORMAT(m.created_at, '%Y-%m-%dT%H:%i:%sZ') AS created_at,
        u.full_name AS sender_name, u.role AS sender_role
        FROM family_messages m JOIN users u ON u.id = m.sender_id
        WHERE conversation_id = ? AND m.id < ? ORDER BY m.id DESC LIMIT 60`).all(id, before);
      return rows.reverse();
    },
    async markRead(conversationId, userId, messageId) {
      await db.prepare(`INSERT INTO family_message_reads (conversation_id, user_id, last_message_id)
        VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE last_message_id = GREATEST(last_message_id, VALUES(last_message_id))`)
        .run(conversationId, userId, messageId);
    },
    async saveMessage({ classId, parentId, senderId, body, submissionKey, recipientIds }) {
      return db.transaction(async (tx) => {
        await tx.prepare(`INSERT INTO family_conversations (class_id, parent_id, created_at) VALUES (?, ?, UTC_TIMESTAMP())
          ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`).run(classId, parentId);
        const conversation = await tx.prepare('SELECT id FROM family_conversations WHERE class_id = ? AND parent_id = ?').get(classId, parentId);
        // The per-form random key makes reloads and double-clicks idempotent.
        const previous = await tx.prepare('SELECT conversation_id, sender_id FROM family_messages WHERE submission_key = ?').get(submissionKey);
        if (previous) {
          if (previous.conversation_id !== conversation.id || previous.sender_id !== senderId) throw new Error('Submission key already used.');
          return conversation.id;
        }
        const message = await tx.prepare(`INSERT INTO family_messages (conversation_id, sender_id, body, submission_key, created_at)
          VALUES (?, ?, ?, ?, UTC_TIMESTAMP())`).run(conversation.id, senderId, body, submissionKey);
        for (const recipientId of new Set(recipientIds)) {
          if (recipientId === senderId) continue;
          await tx.prepare(`INSERT INTO communication_outbox (dedupe_key, kind, user_id, class_id, conversation_id, next_attempt_at)
            VALUES (?, 'message', ?, ?, ?, UTC_TIMESTAMP())`)
            .run(`message:${message.lastInsertRowid}:${recipientId}`, recipientId, classId, conversation.id);
        }
        return conversation.id;
      });
    },
    async enqueueReminder(classId, date, userId) {
      await db.prepare(`INSERT INTO communication_outbox (dedupe_key, kind, user_id, class_id, session_date, next_attempt_at)
        VALUES (?, 'reminder', ?, ?, ?, UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE
          attempts = IF(status = 'skipped', 0, attempts),
          next_attempt_at = IF(status = 'skipped', UTC_TIMESTAMP(), next_attempt_at),
          last_error = IF(status = 'skipped', NULL, last_error),
          status = IF(status = 'skipped', 'pending', status)`)
        .run(`reminder:${classId}:${date}:${userId}`, userId, classId, date);
    },
    async claimJobs() {
      const candidates = await db.prepare(`SELECT id FROM communication_outbox
        WHERE ((status = 'pending' AND next_attempt_at <= UTC_TIMESTAMP())
          OR (status = 'sending' AND locked_until < UTC_TIMESTAMP())) AND attempts < 5
        ORDER BY id LIMIT 1`).all();
      const jobs = [];
      for (const { id } of candidates) {
        const token = crypto.randomUUID();
        const result = await db.prepare(`UPDATE communication_outbox SET status = 'sending', claim_token = ?,
          locked_until = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 10 MINUTE), attempts = attempts + 1
          WHERE id = ? AND ((status = 'pending' AND next_attempt_at <= UTC_TIMESTAMP())
            OR (status = 'sending' AND locked_until < UTC_TIMESTAMP())) AND attempts < 5`).run(token, id);
        if (result.changes) jobs.push(await db.prepare(`SELECT *, DATE_FORMAT(session_date, '%Y-%m-%d') AS session_date
          FROM communication_outbox WHERE id = ? AND claim_token = ?`).get(id, token));
      }
      return jobs;
    },
    async finishJob(job, status, error = null) {
      await db.prepare(`UPDATE communication_outbox SET status = ?, last_error = ?,
        sent_at = CASE WHEN ? = 'sent' THEN UTC_TIMESTAMP() ELSE NULL END,
        next_attempt_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? MINUTE), locked_until = NULL, claim_token = NULL
        WHERE id = ? AND claim_token = ?`)
        .run(status, error, status, Math.min(60, 5 * 2 ** job.attempts), job.id, job.claim_token);
    },
    async expireAbandonedJobs() {
      await db.prepare(`UPDATE communication_outbox SET status = 'failed', last_error = 'Delivery attempts exhausted.'
        WHERE status = 'sending' AND locked_until < UTC_TIMESTAMP() AND attempts >= 5`).run();
    },
  };
}

module.exports = { createCommunicationStore, staffRoles };
