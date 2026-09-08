const { lockPaymentTargets, refreshPaymentTargets } = require('./payment-maintenance');
class PaymentCorrectionError extends Error {}
async function correctPaymentAmount(db, paymentId, input, actorId) {
  const amount = String(input.amount ?? '').trim();
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0 || Number(amount) > 9999999999.99)
    throw new PaymentCorrectionError('Enter a positive amount with no more than two decimal places.');
  if (!reason || reason.length > 500 || !actorId) throw new PaymentCorrectionError('A reason of 1–500 characters is required.');
  return db.transaction(async tx => {
    const targets = await lockPaymentTargets(tx, paymentId);
    const payment = await tx.prepare('SELECT * FROM tuition_payments WHERE id = ? FOR UPDATE').get(paymentId);
    if (!payment) throw new PaymentCorrectionError('Payment not found.');
    if (await tx.prepare('SELECT payment_id FROM tuition_payment_voids WHERE payment_id = ?').get(paymentId))
      throw new PaymentCorrectionError('A voided payment cannot be corrected.');
    const cents = value => value == null || value === '' ? null : Math.round(Number(value) * 100);
    // A retry of the same correction must not create another audit row.
    if (cents(payment.amount) === cents(amount)) return { unchanged: true };
    if (!Object.hasOwn(input, 'original_amount') || cents(payment.amount) !== cents(input.original_amount))
      throw new PaymentCorrectionError('This payment changed since you opened it. Reload and review the current amount.');
    await tx.prepare(`INSERT INTO tuition_payment_corrections (payment_id, old_amount, new_amount, reason, recorded_by)
      VALUES (?, ?, ?, ?, ?)`).run(paymentId, payment.amount, Number(amount), reason, actorId);
    await tx.prepare('UPDATE tuition_payments SET amount = ? WHERE id = ?').run(Number(amount), paymentId);
    await refreshPaymentTargets(tx, targets);
    return { unchanged: false };
  });
}
module.exports = { correctPaymentAmount, PaymentCorrectionError };
