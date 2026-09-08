const { test } = require('node:test');
const assert = require('node:assert/strict');
const { appendPayment, importKey } = require('../payment-ledger');
const { getDashboardPayments } = require('../dashboard-payments');
const { voidPayment } = require('../payment-void');
const { exceptionKey, resolveException } = require('../payment-exceptions');

test('exception identity stays stable across repeated uploads with an unknown date', () => {
  const row = { raw: { transactionId: '', createdAt: '' }, amount: 25, paidAtIso: '2026-01-01' };
  assert.equal(exceptionKey('2026-2027', row), exceptionKey('2026-2027', { ...row, paidAtIso: '2026-02-01' }));
  assert.equal(exceptionKey('2026-2027', { ...row, raw: { transactionId: 'abc' } }), importKey('abc'));
});

test('review requires a note and closing records actor without adding a payment', async () => {
  await assert.rejects(resolveException({}, 1, { action: 'close', note: ' ' }, 9), /note/);
  const writes = [];
  const db = { transaction: async fn => fn({ prepare: sql => ({
    get: async () => ({ id: 1 }),
    run: async (...args) => writes.push({ sql, args }),
  }) }) };
  await resolveException(db, 1, { action: 'close', note: 'Confirmed duplicate against receipt 42' }, 9);
  assert.equal(writes.length, 1);
  assert.match(writes[0].sql, /^UPDATE tuition_payment_exceptions/);
  assert.deepEqual(writes[0].args, [9, 'close: Confirmed duplicate against receipt 42', 1]);
});

test('review rejects cross-family matches before payment mutation', async () => {
  let writes = 0;
  const db = { transaction: async fn => fn({ prepare: sql => ({
    get: async id => sql.includes('tuition_payment_exceptions')
      ? { payload: JSON.stringify({ raw: {} }), school_year: '2026-2027' }
      : { id, user_id: id, student_id: null },
    run: async () => { writes++; },
  }) }) };
  await assert.rejects(resolveException(db, 1, { action: 'match', note: 'Verified', registration_ids: [1, 2] }, 9), /one family/);
  assert.equal(writes, 0);
});

test('void requires a reason before opening a transaction', async () => {
  await assert.rejects(voidPayment({ transaction() { throw Error('Unexpected transaction'); } }, 1, '  ', 1), /reason/);
});

test('void preserves payment, records actor once, and refreshes all shared targets', async () => {
  const audit = [];
  const updates = [];
  const db = { transaction: async fn => fn({ prepare(sql) { return {
    all: async () => {
      if (sql.startsWith('SELECT registration_id')) return [{ registration_id: 1 }, { registration_id: 2 }];
      if (sql.startsWith('SELECT id FROM students')) return [{ id: 11 }, { id: 12 }];
      if (sql.startsWith('SELECT p.*')) return [];
      throw Error(sql);
    },
    get: async () => sql.includes('FROM tuition_payment_voids') ? audit[0] : { id: 1 },
    run: async (...args) => {
      if (sql.startsWith('INSERT INTO tuition_payment_voids')) audit.push(args);
      else if (sql.startsWith('UPDATE students') || sql.startsWith('UPDATE student_registrations')) updates.push(args);
      else throw Error('Unexpected mutation: ' + sql);
    },
  }; } }) };
  await voidPayment(db, 9, ' Duplicate import ', 3);
  await voidPayment(db, 9, 'retry', 3);
  assert.deepEqual(audit, [[9, 'Duplicate import', 3]]);
  assert.equal(updates.length, 4);
  assert.deepEqual(updates.map(args => args.at(-1)), [1, 2, 11, 12]);
  assert.ok(updates.every(args => args[0] === 0 && args[1] === 0 && args[4] === null));
});

function fixture() {
  const state = { entries: [], links: [], totals: [], snapshots: [] };
  let fail = false;
  const tx = { prepare(sql) { return {
    async get(...args) {
      if (sql.includes('FOR UPDATE')) return { id: args[0] };
      if (sql.includes('WHERE entry_key')) return state.entries.find(p => p.key === args[0]);
      if (sql.includes('SUM(p.amount)')) {
        const ids = new Set(state.links.filter(l => l.registrationId === args[0]).map(l => l.paymentId));
        return { total: state.entries.filter(p => ids.has(p.id)).reduce((n,p) => n + p.amount, 0), payment_count: ids.size };
      }
      throw Error('Unexpected read: ' + sql);
    },
    async run(...args) {
      if (sql.includes('INSERT INTO tuition_payments')) {
        if (state.entries.some(p => p.key === args[0])) throw Object.assign(new Error('Duplicate'), { code: 'ER_DUP_ENTRY' });
        state.entries.push({ id: state.entries.length + 1, key: args[0], amount: args[1], method: args[3] });
      } else if (sql.includes('INSERT INTO tuition_payment_links')) {
        state.links.push({ paymentId: args[0], registrationId: args[2], studentId: args[3] });
      } else if (sql.startsWith('UPDATE')) {
        if (fail) throw Error('Injected failure');
        state.totals.push(args[0]);
        state.snapshots.push(args);
      } else throw Error('Unexpected write: ' + sql);
      return { changes: 1 };
    },
  }; } };
  const db = { transaction: async fn => {
    const before = structuredClone(state);
    try { return await fn(tx); } catch (error) { Object.assign(state, before); throw error; }
  } };
  return { db, state, fail: () => { fail = true; } };
}

test('manual installments preserve imported history, retry once, and retain receipt amounts', async () => {
  const { db, state } = fixture();
  const targets = [{ registrationId: 1, studentId: 11 }, { registrationId: 2, studentId: 12 }];
  const entry = { key: importKey('original'), amount: 100, date: '2026-09-07', method: 'imported', recordedBy: 1 };
  await appendPayment(db, entry, targets);
  assert.deepEqual(state.snapshots.at(-1), [100, entry.date, 1, 'imported', null, 12]);
  const added = await appendPayment(db, { ...entry, key: 'manual:one', amount: 25.75, method: 'check' }, [targets[0]]);
  const retry = await appendPayment(db, { ...entry, key: 'manual:one', amount: 25.75, method: 'check' }, [targets[0]]);
  await appendPayment(db, { ...entry, key: 'manual:two', amount: 10.25, method: 'credit_card' }, [targets[0]]);
  assert.equal(retry.id, added.id); assert.equal(retry.duplicate, true);
  assert.equal(state.entries.length, 3);
  assert.deepEqual(state.entries.map(p => p.amount), [100, 25.75, 10.25]);
  assert.equal(state.totals.at(-1), 136);
  assert.deepEqual(state.snapshots.at(-2), [136, null, null, null, null, 1]);
  assert.deepEqual(state.snapshots.at(-1), [136, null, null, null, null, 11]);
});

test('failed snapshot update rolls back the new history entry', async () => {
  const f = fixture(); f.fail();
  await assert.rejects(appendPayment(f.db, { key: 'fail', amount: 25, date: '2026-09-07', method: 'check', recordedBy: 1 }, [{ registrationId: 1, studentId: 11 }]));
  assert.equal(f.state.entries.length, 0); assert.equal(f.state.links.length, 0);
});

test('dashboard sums installments once, preserves cents, and scopes the family', () => {
  const rows = [{ id: 1, user_id: 1, status: 'admitted', registration_fee: 200 }];
  const ledger = [
    { id: 1, registration_id: 1, user_id: 1, amount: '100.25', student_full_name: 'One' },
    { id: 2, registration_id: 1, user_id: 1, amount: '25.50', student_full_name: 'One' },
    { id: 2, registration_id: 1, user_id: 1, amount: '25.50', student_full_name: 'One' },
    { id: 3, registration_id: 2, user_id: 2, amount: '500', student_full_name: 'Other' },
  ];
  const result = getDashboardPayments(rows, 1, ledger);
  assert.equal(result.payments.length, 2); assert.equal(result.balance, 74.25);
  assert.equal(result.totalRecorded, 125.75);
});

test('deleted payment target aborts before inserting an entry', async () => {
  let writes = 0;
  const db = { transaction: async fn => fn({ prepare: () => ({ get: async () => undefined, run: async () => { writes++; } }) }) };
  await assert.rejects(appendPayment(db, { key: 'deleted', amount: 25, date: '2026-09-07', method: 'check', recordedBy: 1 }, [{ registrationId: 1, studentId: 11 }]), /no longer exists/);
  assert.equal(writes, 0);
});

test('completed migration releases its lock without copying snapshots again', async () => {
  const queries = [];
  let released = false;
  const connection = {
    query: async sql => { queries.push(sql); if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]]; if (sql.includes('SELECT setting_value')) return [[{ setting_value: '1' }]]; return [[]]; },
    rollback: async () => {}, release: () => { released = true; },
  };
  await require('../payment-schema')({ getConnection: async () => connection });
  assert.equal(released, true);
  assert.ok(queries.some(sql => sql.includes('RELEASE_LOCK')));
  assert.ok(!queries.some(sql => sql.includes('INSERT')));
});
