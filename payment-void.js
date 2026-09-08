async function voidPayment(db, paymentId, reason, actorId) {
  reason = typeof reason === 'string' ? reason.trim() : '';
  if (!reason || reason.length > 500 || !actorId) throw new Error('A reason of 1–500 characters is required.');
  return db.transaction(async tx => {
    const links = await tx.prepare('SELECT registration_id, student_id FROM tuition_payment_links WHERE payment_id = ?').all(paymentId);
    const registrations = [...new Set(links.map(l => l.registration_id).filter(Boolean))].sort((a,b) => a-b);
    const students = await tx.prepare(`SELECT id FROM students WHERE id IN
      (SELECT student_id FROM tuition_payment_links WHERE payment_id = ?) OR source_registration_id IN
      (SELECT registration_id FROM tuition_payment_links WHERE payment_id = ?) ORDER BY id`).all(paymentId, paymentId);
    for (const id of registrations) await tx.prepare('SELECT id FROM student_registrations WHERE id = ? FOR UPDATE').get(id);
    for (const student of students) await tx.prepare('SELECT id FROM students WHERE id = ? FOR UPDATE').get(student.id);
    const payment = await tx.prepare('SELECT id FROM tuition_payments WHERE id = ? FOR UPDATE').get(paymentId);
    if (!payment) throw new Error('Payment not found.');
    if (await tx.prepare('SELECT payment_id FROM tuition_payment_voids WHERE payment_id = ?').get(paymentId)) return;
    await tx.prepare('INSERT INTO tuition_payment_voids (payment_id, reason, recorded_by) VALUES (?, ?, ?)').run(paymentId, reason, actorId);
    for (const [table, ids, predicate] of [
      ['student_registrations', registrations, 'l.registration_id = ?'],
      ['students', students.map(s => s.id), 'l.student_id = ? OR l.registration_id = (SELECT source_registration_id FROM students WHERE id = ?)'],
    ]) {
      for (const id of ids) {
        const payments = await tx.prepare(`SELECT p.* FROM tuition_payments p WHERE NOT EXISTS
          (SELECT 1 FROM tuition_payment_voids v WHERE v.payment_id = p.id) AND p.id IN
          (SELECT l.payment_id FROM tuition_payment_links l WHERE ${predicate})`).all(...(table === 'students' ? [id,id] : [id]));
        const only = payments.length === 1 ? payments[0] : {};
        const total = payments.some(p => p.amount == null) ? null : payments.reduce((sum,p) => sum + Math.round(Number(p.amount)*100), 0)/100;
        await tx.prepare(`UPDATE ${table} SET tuition_paid = ?, tuition_amount_paid = ?, tuition_paid_at = ?, tuition_paid_by = ?, tuition_payment_method = ?, tuition_transaction_id = ? WHERE id = ?`)
          .run(payments.length ? 1 : 0, total, only.paid_at || null, only.recorded_by || null, only.method || null, only.transaction_id || null, id);
      }
    }
  });
}
module.exports = { voidPayment };
