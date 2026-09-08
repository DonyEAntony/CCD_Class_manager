// Keep siblings visible even when they have no linked ledger entries.
function buildFamilyPaymentRows(family, history, currentStudentId) {
  const members = new Map(family.map(child => [String(child.id), child]));
  const covered = new Set();
  const entries = new Map();
  for (const payment of history) {
    const childId = String(payment.student_id);
    if (!members.has(childId)) continue;
    covered.add(childId);
    const key = String(payment.id);
    if (!entries.has(key)) entries.set(key, {
      id: payment.student_id, paymentId: payment.id, tuitionPaid: true,
      amount: payment.amount, method: payment.method, paidAt: payment.paid_at,
      voidedAt: payment.voided_at, voidReason: payment.void_reason,
      voidedBy: payment.voided_by_name, recordedBy: payment.recorded_by_name,
      recordedAt: payment.created_at,
      names: new Set(), isSelf: false,
    });
    const entry = entries.get(key);
    entry.names.add(members.get(childId).student_full_name);
    entry.isSelf ||= childId === String(currentStudentId);
  }
  const rows = [...entries.values()].map(({ names, ...entry }) => ({
    ...entry, studentFullName: [...names].join(', '),
  }));
  for (const [childId, child] of members) {
    if (covered.has(childId)) continue;
    rows.push({ id: child.id, paymentId: null, noHistory: true,
      tuitionPaid: Number(child.tuition_paid) === 1,
      amount: null, method: null, paidAt: null,
      studentFullName: child.student_full_name, isSelf: childId === String(currentStudentId) });
  }
  return rows;
}

module.exports = { buildFamilyPaymentRows };
