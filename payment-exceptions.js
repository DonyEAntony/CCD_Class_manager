const { appendPayment, importKey } = require('./payment-ledger');
const exceptionKey = (year, row) => row.raw.transactionId ? importKey(row.raw.transactionId)
  : importKey(JSON.stringify([year, row.raw, row.amount]));

async function saveException(db, year, row, category) {
  await db.prepare(`INSERT INTO tuition_payment_exceptions (entry_key, school_year, payload, category)
    VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE entry_key = VALUES(entry_key)`)
    .run(exceptionKey(year, row), year, JSON.stringify(row), category);
}

async function resolveException(db, id, input, actorId) {
  const note = typeof input.note === 'string' ? input.note.trim() : '';
  if (!note || note.length > 1000) throw Error('Enter a resolution note (1–1000 characters).');
  if (!['match', 'close'].includes(input.action)) throw Error('Choose a valid resolution.');
  return db.transaction(async tx => {
    const item = await tx.prepare('SELECT * FROM tuition_payment_exceptions WHERE id = ? FOR UPDATE').get(id);
    if (!item) throw Error('Review item not found.');
    if (item.resolved_at) return;
    if (input.action === 'match') {
      const row = JSON.parse(item.payload);
      const ids = [...new Set((Array.isArray(input.registration_ids) ? input.registration_ids : [input.registration_ids]).map(Number))];
      if (!ids.length || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw Error('Select the registrations covered by this payment.');
      const targets = [];
      let owner;
      for (const registrationId of ids.sort((a,b) => a-b)) {
        const reg = await tx.prepare(`SELECT id, student_id, user_id FROM student_registrations
          WHERE id = ? AND school_year = ? AND archived_at IS NULL AND status <> 'cancelled' FOR UPDATE`).get(registrationId, item.school_year);
        if (!reg || !reg.user_id || (owner !== undefined && owner !== reg.user_id)) throw Error('Select registrations from one family in the payment school year.');
        owner = reg.user_id;
        targets.push({ registrationId: reg.id, studentId: reg.student_id });
      }
      const amount = String(input.amount || '').trim();
      if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) throw Error('Enter a confirmed positive payment amount.');
      const date = String(input.paid_at || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date) throw Error('Enter the confirmed payment date.');
      const result = await appendPayment({ transaction: fn => fn(tx) }, {
        key: item.entry_key, amount: Number(amount), date,
        method: 'imported', transactionId: row.raw.transactionId || null, recordedBy: actorId,
      }, targets);
      if (result.duplicate) throw Error('This payment already exists. Review its history and close this item with a note; no payment was added.');
    }
    await tx.prepare(`UPDATE tuition_payment_exceptions SET resolved_at = CURRENT_TIMESTAMP,
      resolved_by = ?, resolution_note = ? WHERE id = ?`).run(actorId, `${input.action}: ${note}`, id);
  });
}
module.exports = { exceptionKey, saveException, resolveException };
