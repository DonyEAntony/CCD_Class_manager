const { test } = require('node:test');
const assert = require('node:assert/strict');
const { appendPayment, importKey } = require('../payment-ledger');
const { getDashboardPayments } = require('../dashboard-payments');

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
