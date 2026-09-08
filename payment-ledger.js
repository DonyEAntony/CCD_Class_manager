const crypto = require('crypto');
const importKey = id => 'import:' + crypto.createHash('sha256').update(String(id)).digest('hex');

async function appendPayment(db, entry, targets) {
  if (!Number.isFinite(Number(entry.amount)) || Number(entry.amount) <= 0 || Number(entry.amount) > 9999999999.99 ||
      !['cash', 'check', 'credit_card', 'imported'].includes(entry.method) || !entry.key || !targets.length) {
    throw new Error('Invalid payment entry');
  }
  return db.transaction(async tx => {
    // Lock targets in a stable order so simultaneous installments serialize their
    // compatibility totals. The entry key makes retries of one submission harmless.
    for (const target of [...targets].sort((a,b) => (a.registrationId || 0) - (b.registrationId || 0) || (a.studentId || 0) - (b.studentId || 0))) {
      if (target.registrationId && !await tx.prepare('SELECT id FROM student_registrations WHERE id = ? FOR UPDATE').get(target.registrationId)) {
        throw new Error('Payment registration no longer exists');
      }
      if (target.studentId && !await tx.prepare('SELECT id FROM students WHERE id = ? FOR UPDATE').get(target.studentId)) {
        throw new Error('Payment student no longer exists');
      }
    }
    let inserted = true;
    try {
      await tx.prepare(`INSERT INTO tuition_payments (entry_key, amount, paid_at, method, transaction_id, recorded_by)
        VALUES (?, ?, ?, ?, ?, ?)`).run(entry.key, entry.amount, entry.date, entry.method, entry.transactionId || null, entry.recordedBy);
    } catch (error) {
      if (error.code !== 'ER_DUP_ENTRY') throw error;
      inserted = false;
    }
    const payment = await tx.prepare('SELECT id FROM tuition_payments WHERE entry_key = ?').get(entry.key);
    if (!inserted) return { id: payment.id, duplicate: true };
    for (const target of targets) {
      await tx.prepare(`INSERT INTO tuition_payment_links (payment_id, target_key, registration_id, student_id) VALUES (?, ?, ?, ?)`)
        .run(payment.id, target.registrationId ? `registration:${target.registrationId}` : `student:${target.studentId}`, target.registrationId || null, target.studentId || null);
      const total = await tx.prepare(`SELECT SUM(p.amount) AS total, COUNT(*) AS payment_count,
          SUM(p.amount IS NULL) AS unknown_count FROM tuition_payments p WHERE NOT EXISTS
        (SELECT 1 FROM tuition_payment_voids v WHERE v.payment_id = p.id) AND p.id IN
        (SELECT l.payment_id FROM tuition_payment_links l WHERE ${target.registrationId ? 'l.registration_id' : 'l.student_id'} = ?)`)
        .get(target.registrationId || target.studentId);
      for (const [table, id] of [['student_registrations', target.registrationId], ['students', target.studentId]]) {
        if (!id) continue;
        await tx.prepare(`UPDATE ${table} SET tuition_paid = 1, tuition_amount_paid = ?, tuition_paid_at = ?, tuition_paid_by = ?, tuition_payment_method = ?, tuition_transaction_id = ? WHERE id = ?`)
          // A cumulative amount must not masquerade as the newest transaction.
          // Individual dates, methods, and references remain in the ledger. And
          // SQL's SUM() silently skips NULL amounts (e.g. a legacy import the
          // migration flagged as unconfirmed) — if any linked payment's amount
          // is unknown, the total is unknown too, not a partial figure that
          // looks complete.
          .run(Number(total.unknown_count) > 0 ? null : total.total,
            Number(total.payment_count) === 1 ? entry.date : null,
            Number(total.payment_count) === 1 ? entry.recordedBy : null,
            Number(total.payment_count) === 1 ? entry.method : null,
            Number(total.payment_count) === 1 ? entry.transactionId || null : null, id);
      }
    }
    return { id: payment.id, duplicate: false };
  });
}

async function registrationPayments(db, userId = null) {
  // A link can carry only a student_id with no registration_id (a student
  // whose source registration was deleted — students.source_registration_id
  // is ON DELETE SET NULL, see db.js). An INNER JOIN straight to
  // student_registrations silently drops those payments from every
  // registration-keyed view (the parent dashboard, the admin attention
  // queue) even though they're still real and still visible via the receipt
  // route and /admin/students, which both also match on student_id. Falling
  // back through the student row resolves a registration wherever one is
  // still linkable; a payment whose student has no registration at all
  // (never had one, or it was deleted with nothing to replace it) still has
  // no registration-keyed home to attach to and is excluded here — that's a
  // real limitation of a registration-centric payments view, not something
  // this query alone can fix.
  return db.prepare(`SELECT p.*, COALESCE(r.id, r2.id) AS registration_id,
      COALESCE(r.user_id, r2.user_id) AS user_id, COALESCE(r.student_full_name, r2.student_full_name) AS student_full_name
    FROM tuition_payments p
    JOIN tuition_payment_links l ON l.payment_id = p.id
    LEFT JOIN student_registrations r ON r.id = l.registration_id
    LEFT JOIN students s ON s.id = l.student_id
    LEFT JOIN student_registrations r2 ON r2.id = s.source_registration_id
    WHERE NOT EXISTS (SELECT 1 FROM tuition_payment_voids v WHERE v.payment_id = p.id)
      AND COALESCE(r.id, r2.id) IS NOT NULL AND COALESCE(r.archived_at, r2.archived_at) IS NULL
      ${userId === null ? '' : 'AND COALESCE(r.user_id, r2.user_id) = ?'}
    ORDER BY p.paid_at DESC, p.id DESC`).all(...(userId === null ? [] : [userId]));
}
module.exports = { appendPayment, registrationPayments, importKey };
