const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getFamilyNextClasses } = require('../dashboard-family');
const child = (id, classId, extra = {}) => ({ reg: { id, user_id: 1, student_full_name: `Child ${id}`, status: 'admitted', ...extra }, assignedClass: { id: classId }, gradeLabel: 'Grade 2' });
const base = { user: { id: 1, role: 'user' }, today: '2026-09-07', formatDate: value => value };

test('groups siblings, keeps all classes on the nearest date and ignores past dates and other events', async () => {
  const queries = [];
  const result = await getFamilyNextClasses({ ...base, children: [child(1, 10), child(2, 10), child(3, 11), child(4, 12)], getSchedule: async id => {
    queries.push(id);
    return [{ date: '2026-09-01', eventType: 'class_day' }, { date: '2026-09-07', eventType: 'retreat' }, { date: id === 12 ? '2026-09-20' : '2026-09-13', eventType: 'class_day' }];
  } });
  assert.deepEqual(queries, [10, 11, 12]);
  assert.equal(result.date, '2026-09-13');
  assert.equal(result.classes.length, 2);
  assert.equal(result.classes[0].children.length, 2);
});

test('excludes other families, archived and unaccepted registrations; retains conditional status', async () => {
  const result = await getFamilyNextClasses({ ...base, children: [child(1, 10, { user_id: 2 }), child(2, 11, { archived_at: '2026-01-01' }), child(3, 12, { status: 'in_progress' }), child(4, 13, { status: 'conditionally_accepted' })], getSchedule: async id => {
    assert.equal(id, 13);
    return [{ date: '2026-09-07', eventType: 'class_day' }];
  } });
  assert.equal(result.classes[0].children[0].conditional, true);
});

test('empty schedules show no invented date and staff roles do not query schedules', async () => {
  const result = await getFamilyNextClasses({ ...base, children: [child(1, 10)], getSchedule: async () => [] });
  assert.deepEqual(result, { hasClasses: true, date: null, classes: [] });
  for (const role of ['admin', 'catechist', 'family_faith_leader']) {
    assert.equal(await getFamilyNextClasses({ ...base, user: { id: 1, role } }), null);
  }
});
