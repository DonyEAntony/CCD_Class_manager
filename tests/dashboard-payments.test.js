const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getDashboardPayments } = require('../dashboard-payments');
const { buildFamilyPaymentRows } = require('../family-payments');

test('admin family history retains unpaid siblings alongside multiple payments', () => {
  const family = [{ id: 1, student_full_name: 'Paid child', tuition_paid: 1 },
    { id: 2, student_full_name: 'Unpaid sibling', tuition_paid: 0 }];
  const history = [
    { id: 10, student_id: 1, amount: 50, method: 'import' },
    { id: 11, student_id: 1, amount: 25, method: 'check' },
    { id: 12, student_id: 99, amount: 100, method: 'check' },
  ];
  const rows = buildFamilyPaymentRows(family, history, 2);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(r => r.paymentId), [10, 11, null]);
  assert.equal(rows[2].studentFullName, 'Unpaid sibling');
  assert.equal(rows[2].tuitionPaid, false);
  assert.equal(rows[2].noHistory, true);
  assert.equal(rows[2].isSelf, true);
  assert.equal(rows[2].amount, null);
  assert.equal(rows[2].method, null);
});

test('admin shared payments appear once without false unpaid sibling rows', () => {
  const family = [{ id: 1, student_full_name: 'First' }, { id: 2, student_full_name: 'Second' }];
  const rows = buildFamilyPaymentRows(family, [
    { id: 10, student_id: '1', amount: 200 },
    { id: 10, student_id: 2, amount: 200 },
    { id: 10, student_id: 2, amount: 200 },
  ], 2);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].studentFullName, 'First, Second');
  assert.equal(rows[0].amount, 200);
  assert.equal(rows[0].isSelf, true);
});

test('admin families without history retain every child and distinguish paid flags', () => {
  const rows = buildFamilyPaymentRows([
    { id: 1, student_full_name: 'Same name', tuition_paid: 0 },
    { id: 2, student_full_name: 'Same name', tuition_paid: 1 },
  ], [], 1);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.tuitionPaid), [false, true]);
  assert.ok(rows.every(r => r.noHistory && r.paymentId === null));
});
const row = { id: 1, user_id: 1, student_full_name: 'Sample', status: 'admitted', registration_fee: 150, sacramental_fee: 25 };
test('single-child balances reflect confirmed amounts and never become negative', () => {
  assert.equal(getDashboardPayments([row], 1).balance, 175);
  for (const [amount, expected] of [[50, 125], [175, 0], [200, 0]]) {
    assert.equal(getDashboardPayments([{ ...row, tuition_paid: 1, tuition_amount_paid: amount }], 1).balance, expected);
  }
});
test('shared transaction is displayed once and ambiguous family balance is not invented', () => {
  const paid = { ...row, tuition_paid: 1, tuition_amount_paid: 200, tuition_transaction_id: 'family-123' };
  const result = getDashboardPayments([paid, { ...paid, id: 2, student_full_name: 'Sibling' }], 1);
  assert.equal(result.payments.length, 1);
  assert.equal(result.payments[0].amount, 200);
  assert.equal(result.payments[0].names.length, 2);
  assert.equal(result.balance, null);
});
test('paid flag without amount does not produce a payment request', () => {
  const result = getDashboardPayments([{ ...row, tuition_paid: 1 }], 1);
  assert.equal(result.balance, null);
  assert.equal(result.allMarkedPaid, true);
});
test('unconfirmed stale payment data and excluded registrations do not count', () => {
  const result = getDashboardPayments([{ ...row, tuition_paid: 0, tuition_amount_paid: 175 }, { ...row, user_id: 2 }, { ...row, archived_at: '2026-01-01' }, { ...row, status: 'cancelled' }, { ...row, status: 'incomplete' }], 1);
  assert.equal(result.rows.length, 1);
  assert.equal(result.payments.length, 0);
  assert.equal(result.balance, 175);
});

const family = [
  { ...row, school_year: '2026-2027', registration_fee: 200, sacramental_fee: 25 },
  { ...row, id: 2, student_full_name: 'Sibling', school_year: '2026-2027', registration_fee: 0, sacramental_fee: 50, late_fee: 10 },
];
const sharedPayment = amount => family.map(child => ({ id: 10, registration_id: child.id, user_id: 1, amount, student_full_name: child.student_full_name }));

test('unpaid families receive a balance with the family fee once and each child fee included', () => {
  const result = getDashboardPayments(family, 1, []);
  assert.equal(result.balance, 285);
  assert.deepEqual(result.issues, []);
});

test('shared family payments and later installments reduce the balance once per payment', () => {
  const history = [...sharedPayment('200.00'), { id: 11, registration_id: 1, user_id: 1, amount: '25.50' }];
  const partial = getDashboardPayments(family, 1, history);
  assert.equal(partial.totalRecorded, 225.50);
  assert.equal(partial.balance, 59.50);
  assert.equal(partial.payments.length, 2);
  assert.equal(getDashboardPayments(family, 1, [...history, { id: 12, registration_id: 2, user_id: 1, amount: '59.50' }]).balance, 0);
});

test('different registration years each carry their own family fee and payment balance', () => {
  const rows = [...family, { ...row, id: 3, school_year: '2025-2026', registration_fee: 150, sacramental_fee: 0 }];
  const result = getDashboardPayments(rows, 1, [{ id: 1, registration_id: 3, user_id: 1, amount: '200' }]);
  assert.equal(result.years.length, 2);
  assert.equal(result.balance, 285); // Prior-year overpayment is not silently reassigned.
});

test('only specific missing or conflicting family records require confirmation', () => {
  assert.deepEqual(getDashboardPayments(family, 1, sharedPayment(null)).issues, ['unknown_payment_amount']);
  assert.ok(getDashboardPayments([family[0], { ...family[1], registration_fee: 200 }], 1, []).issues.includes('conflicting_registration_charges'));
  assert.ok(getDashboardPayments([{ ...family[0], school_year: null }, family[1]], 1, []).issues.includes('missing_year'));
  const crossYear = [family[0], { ...family[1], school_year: '2025-2026', registration_fee: 150 }];
  assert.ok(getDashboardPayments(crossYear, 1, sharedPayment(200)).issues.includes('payment_spans_years'));
});
