const toCents = value => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : null;
};

function getDashboardPayments(registrations, userId, ledger) {
  const rows = registrations.filter(row => String(row.user_id) === String(userId) && !row.archived_at && !['cancelled', 'incomplete'].includes(row.status));
  const byId = new Map(rows.map(row => [String(row.id), row]));
  // Keep previews/older callers on the same calculation as ledger callers.
  const history = ledger || rows.filter(row => Number(row.tuition_paid) === 1).map(row => ({
    id: row.tuition_transaction_id ? `transaction:${row.tuition_transaction_id}` : `registration:${row.id}`,
    registration_id: row.id, user_id: row.user_id, student_full_name: row.student_full_name,
    amount: row.tuition_amount_paid, paid_at: row.tuition_paid_at, method: row.tuition_payment_method,
  }));
  const entries = new Map();
  for (const entry of history) {
    if (String(entry.user_id) !== String(userId) || !byId.has(String(entry.registration_id))) continue;
    const cents = entry.amount == null ? null : toCents(entry.amount);
    if (!entries.has(entry.id)) entries.set(entry.id, { id: entry.id, cents, date: entry.paid_at, method: entry.method, names: [], registrationIds: new Set() });
    const payment = entries.get(entry.id);
    if (payment.cents !== cents) payment.cents = null;
    const registrationId = String(entry.registration_id);
    if (!payment.registrationIds.has(registrationId)) payment.names.push(byId.get(registrationId).student_full_name);
    payment.registrationIds.add(registrationId);
  }
  const payments = [...entries.values()].map(payment => ({ ...payment, amount: payment.cents === null ? null : payment.cents / 100 }));
  const yearKey = row => String(row.school_year || '').trim();
  const groups = new Map();
  for (const row of rows) {
    const year = yearKey(row);
    if (!groups.has(year)) groups.set(year, []);
    groups.get(year).push(row);
  }
  const years = [...groups].map(([year, members]) => {
    const issues = new Set();
    if (!year && rows.length > 1) issues.add('missing_year');
    const charges = members.map(row => toCents(row.registration_fee));
    if (members.every(row => row.registration_fee == null)) issues.add('missing_charges');
    if (charges.some(value => value === null)) issues.add('invalid_charges');
    // The wizard assigns the family fee to one child and zero to siblings.
    // Multiple nonzero fees need confirmation, not automatic double charging.
    if (charges.filter(value => value > 0).length > 1) issues.add('conflicting_registration_charges');
    let fees = charges.reduce((sum, value) => sum + (value || 0), 0);
    for (const row of members) {
      for (const key of ['sacramental_fee', 'late_fee']) {
        const cents = toCents(row[key] || 0);
        if (cents === null) issues.add('invalid_charges');
        else fees += cents;
      }
      if (Number(row.tuition_paid) === 1 && !payments.some(payment => payment.registrationIds.has(String(row.id)))) issues.add('missing_payment_history');
    }
    let paid = 0;
    for (const payment of payments) {
      const paymentYears = new Set([...payment.registrationIds].map(id => yearKey(byId.get(id))));
      if (!paymentYears.has(year)) continue;
      if (paymentYears.size > 1) issues.add('payment_spans_years');
      if (payment.cents === null) issues.add('unknown_payment_amount');
      else paid += payment.cents;
    }
    return { year, fees: fees / 100, paid: paid / 100, balance: issues.size ? null : Math.max(0, fees - paid) / 100, issues: [...issues] };
  });
  const issues = [...new Set(years.flatMap(year => year.issues))];
  const knownAmounts = payments.every(payment => payment.cents !== null);
  return {
    rows, payments, years, issues, ledger: Boolean(ledger),
    totalRecorded: knownAmounts ? payments.reduce((sum, payment) => sum + payment.cents, 0) / 100 : null,
    balance: rows.length && !issues.length ? years.reduce((sum, year) => sum + Math.round(year.balance * 100), 0) / 100 : null,
    allMarkedPaid: rows.length > 0 && rows.every(row => Number(row.tuition_paid) === 1),
  };
}
module.exports = { getDashboardPayments };
