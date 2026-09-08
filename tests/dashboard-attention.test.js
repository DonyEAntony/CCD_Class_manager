const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getDashboardAttention } = require('../dashboard-attention');
test('attention queues scope admin access and link missing payments to student details', async () => {
  const db = { prepare(sql) { return { all: async () => sql.includes('FROM tuition_payments') ? [{ id: 7, user_id: 2, registration_id: 1, student_full_name: 'Example', amount: null }] : sql.includes('FROM student_registrations') ? [{ id: 1, user_id: 2, student_id: 3, student_full_name: 'Example', status: 'admitted', tuition_paid: 1 }] : [{ id: 4, grade_level: 'family_faith' }] }; } };
  assert.equal(await getDashboardAttention({ prepare() { throw Error('Query'); } }, { role: 'catechist' }), null);
  const result = await getDashboardAttention(db, { role: 'admin' }, '2026-09-07');
  assert.equal(result.balances.length, 1);
  assert.equal(result.amounts[0].href, '/admin/payments/7/correct');
  assert.equal(result.amounts[0].paymentId, 7);
  assert.equal(result.sessions[0].href, '/admin/classes/4');
});
test('manual check and card entry updates both linked records and opens a receipt', async () => {
  const source = require('fs').readFileSync(require.resolve('../app'), 'utf8');
  const start = source.indexOf("app.post('/admin/students/:id/payment'");
  const a = source.indexOf('asyncHandler(', start) + 'asyncHandler('.length;
  const b = source.indexOf('\n}));', a) + 2;
  for (const method of ['check', 'credit_card']) {
    const writes = [];
    const handler = require('vm').runInNewContext('(' + source.slice(a, b) + ')', {
      TUITION_PAYMENT_METHODS: new Set(['cash', 'check', 'credit_card']),
      appendPayment: async (db, entry, targets) => { writes.push({ entry, targets }); return { id: 9 }; },
      db: { prepare(sql) { return { get: async () => ({ id: 3, source_registration_id: 5 }), run: async (...args) => writes.push({ sql, args }) }; } },
    });
    let destination;
    await handler({ params: { id: '3' }, user: { id: 1 }, body: { amount: '150.25', submission_key: '12345678-1234-1234-1234-123456789abc', method, payment_date: '2026-09-07' }, flash() {} }, { locals: { t: k => k }, redirect(url) { destination = url; } });
    assert.equal(writes.length, 1);
    assert.equal(writes[0].entry.amount, 150.25);
    assert.equal(writes[0].entry.method, method);
    assert.equal(writes[0].targets[0].registrationId, 5);
    assert.equal(destination, '/admin/students/3/receipt?payment=9');
  }
});

test('invalid calendar date is rejected before recording a payment', async () => {
  const source = require('fs').readFileSync(require.resolve('../app'), 'utf8');
  const start = source.indexOf("app.post('/admin/students/:id/payment'");
  const a = source.indexOf('asyncHandler(', start) + 'asyncHandler('.length;
  const b = source.indexOf('\n}));', a) + 2;
  let recorded = false, message;
  const handler = require('vm').runInNewContext('(' + source.slice(a, b) + ')', {
    TUITION_PAYMENT_METHODS: new Set(['check']),
    appendPayment: async () => { recorded = true; },
    db: { prepare: () => ({ get: async () => ({ id: 3, source_registration_id: 5 }) }) },
  });
  await handler({ params: { id: '3' }, user: { id: 1 }, body: { amount: '10', method: 'check', submission_key: '12345678-1234-1234-1234-123456789abc', payment_date: '2026-02-31' }, flash: (_, text) => { message = text; } }, { redirect() {} });
  assert.equal(recorded, false);
  assert.match(message, /valid payment date/);
});

test('fully paid and unpaid multi-child families are absent from the confirmation queue when records are complete', async () => {
  const rows = [{ id: 1, user_id: 1, school_year: '2026-2027', registration_fee: 200, status: 'admitted', student_full_name: 'One' },
    { id: 2, user_id: 1, school_year: '2026-2027', registration_fee: 0, status: 'admitted', student_full_name: 'Two' }];
  for (const history of [[], rows.map(row => ({ id: 1, registration_id: row.id, user_id: 1, amount: 200, student_full_name: row.student_full_name }))]) {
    const db = { prepare(sql) { return { all: async () => sql.includes('FROM tuition_payments') ? history : sql.includes('FROM student_registrations') ? rows : [] }; } };
    const result = await getDashboardAttention(db, { role: 'admin' }, '2026-09-07');
    assert.deepEqual(result.balances, []);
  }
});
