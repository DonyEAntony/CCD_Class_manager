const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getDashboardReview } = require('../dashboard-review');

test('review data is never queried for non-administrators', async () => {
  const db = { prepare() { throw new Error('Unauthorized query'); } };
  for (const role of ['user', 'parent', 'catechist', 'family_faith_leader']) {
    assert.equal(await getDashboardReview(db, { role }), null);
  }
});

test('queue merges oldest records, limits preview and preserves full counts and destination filters', async () => {
  const queries = [];
  const db = { prepare(sql) {
    queries.push(sql);
    return {
      get: async () => ({ total: '8' }),
      all: async (status) => Array.from({ length: 5 }, (_, i) => ({
        id: i + 1, name: status, created_at: `2026-09-${String(i + (status === 'conditionally_accepted' ? 1 : 10)).padStart(2, '0')}`,
      })),
    };
  } };
  const queue = await getDashboardReview(db, { role: 'admin' });
  assert.equal(queue.total, 24);
  assert.equal(queue.items.length, 5);
  assert.ok(queue.items.every((item) => item.key === 'conditional'));
  assert.match(queue.items[0].href, /type=child&status=conditionally_accepted&sort=submitted&dir=asc#registration-child-1$/);
  assert.ok(queries.filter(sql => sql.includes('student_registrations')).every(sql => sql.includes('archived_at IS NULL')));
  assert.ok(queries.filter(sql => sql.startsWith('SELECT id')).every(sql => sql.endsWith('LIMIT 5')));
});

test('empty queue has zero counts and no preview rows', async () => {
  const db = { prepare: () => ({ get: async () => ({ total: 0 }), all: async () => [] }) };
  const queue = await getDashboardReview(db, { role: 'admin' });
  assert.equal(queue.total, 0);
  assert.deepEqual(queue.items, []);
});
