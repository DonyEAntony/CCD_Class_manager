const { getDashboardPayments } = require('./dashboard-payments');
const { registrationPayments } = require('./payment-ledger');
async function getDashboardAttention(db, user, today) {
  if (user.role !== 'admin') return null;
  const registrations = await db.prepare("SELECT id, user_id, student_id, school_year, student_full_name, status, archived_at, registration_fee, sacramental_fee, late_fee, tuition_paid, tuition_amount_paid, tuition_paid_at, tuition_payment_method, tuition_transaction_id FROM student_registrations WHERE archived_at IS NULL").all();
  const balances = [], amounts = [];
  const ledger = await registrationPayments(db);
  const link = row => row.student_id ? `/admin/students?status=all#student-detail-${row.student_id}` : `/admin/registrations?type=child&status=all#registration-child-${row.id}`;
  for (const id of new Set(registrations.map(row => row.user_id))) {
    const summary = getDashboardPayments(registrations, id, ledger);
    if (!summary.rows.length) continue;
    if (summary.balance === null) balances.push({ name: summary.rows.map(row => row.student_full_name).join(', '), href: link(summary.rows[0]), issues: summary.issues, totalRecorded: summary.totalRecorded });
    for (const payment of summary.payments.filter(item => item.amount === null)) {
      // Match by registration id, not name — two active registrations for the
      // same family can share a student_full_name (a renewal that wasn't
      // archived, a duplicate submission), and name-matching could silently
      // link the wrong sibling or find nothing at all.
      const row = summary.rows.find(row => payment.registrationIds.has(String(row.id)));
      if (!row) continue;
      amounts.push({ name: payment.names.join(', '), href: `/admin/payments/${payment.id}/correct`, paymentId: payment.id, date: payment.date, method: payment.method });
    }
  }
  const sessions = await db.prepare(`SELECT c.id, c.grade_level, c.class_time FROM ccd_classes c
    WHERE EXISTS (SELECT 1 FROM ccd_class_catechists cc JOIN users u ON u.id = cc.catechist_user_id WHERE cc.ccd_class_id = c.id AND u.role IN ('catechist', 'family_faith_leader'))
    AND NOT EXISTS (SELECT 1 FROM ccd_class_session_dates s WHERE s.ccd_class_id = c.id AND s.session_date >= ? AND COALESCE(s.event_type, 'class_day') = 'class_day')
    ORDER BY c.grade_level, c.id`).all(today);
  return { balances, amounts, sessions: sessions.map(row => ({ name: `${row.grade_level} · ${row.class_time || ''}`, href: `/admin/classes/${row.id}` })) };
}
module.exports = { getDashboardAttention };
