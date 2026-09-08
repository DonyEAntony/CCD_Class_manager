const { lockPaymentTargets, refreshPaymentTargets } = require('./payment-maintenance');
async function voidPayment(db, paymentId, reason, actorId) {
  reason = typeof reason === 'string' ? reason.trim() : '';
  if (!reason || reason.length > 500 || !actorId) throw new Error('A reason of 1–500 characters is required.');
  return db.transaction(async tx => {
    const targets = await lockPaymentTargets(tx, paymentId);
    const payment = await tx.prepare('SELECT id FROM tuition_payments WHERE id = ? FOR UPDATE').get(paymentId);
    if (!payment) throw new Error('Payment not found.');
    if (await tx.prepare('SELECT payment_id FROM tuition_payment_voids WHERE payment_id = ?').get(paymentId)) return;
    await tx.prepare('INSERT INTO tuition_payment_voids (payment_id, reason, recorded_by) VALUES (?, ?, ?)').run(paymentId, reason, actorId);
    await refreshPaymentTargets(tx, targets);
  });
}
module.exports = { voidPayment };
