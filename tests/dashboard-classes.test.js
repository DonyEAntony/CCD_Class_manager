const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getDashboardClasses } = require('../dashboard-classes');

const options = {
  user: { id: 7, role: 'catechist' }, today: '2026-09-07', formatDate: value => value,
  label: item => item.grade_level,
  classes: [
    { id: 1, grade_level: 'Grade 2', catechists: [{ id: '7' }] },
    { id: 2, grade_level: 'OCIA', classKind: 'adult', catechists: [{ id: 7 }] },
    { id: 3, grade_level: 'Grade 3', catechists: [{ id: 9 }] },
  ],
};

test('Family Faith leaders see only their assigned sessions', async () => {
  const cards = await getDashboardClasses({ ...options, user: { id: 7, role: 'family_faith_leader' }, getSchedule: async id => {
    assert.notEqual(id, 3);
    return [];
  } });
  assert.deepEqual(cards.map(c => c.id).sort(), [1, 2]);
});

test('unassigned leaders cannot change attendance or table assignments', async () => {
  const fs = require('fs');
  const vm = require('vm');
  const source = fs.readFileSync(require.resolve('../app'), 'utf8');
  for (const route of ['attendance', 'tables/organize', 'tables/assign']) {
    const start = source.indexOf(`app.post('/admin/classes/:id/${route}'`);
    const bodyStart = source.indexOf('asyncHandler(async (req, res) => {', start) + 'asyncHandler('.length;
    const bodyEnd = source.indexOf('\n}));', bodyStart) + 2;
    let checks = 0;
    const handler = vm.runInNewContext('(' + source.slice(bodyStart, bodyEnd) + ')', { db: { prepare(sql) {
      assert.match(sql, /ccd_class_catechists/);
      return { get: async () => { checks++; return null; } };
    } } });
    let status;
    const res = { status(code) { status = code; return this; }, json() {} };
    await handler({ user: { id: 7, role: 'family_faith_leader' }, params: { id: '3' }, body: { student_registration_id: '1', session_date: '2026-09-13', status: 'present', table_count: '2', table_number: '1' } }, res);
    assert.equal(status, 403);
    assert.equal(checks, 1);
  }
});

test('only assigned classes are queried; adult classes are included and sorted by next class day', async () => {
  const queried = [];
  const cards = await getDashboardClasses({ ...options, getSchedule: async id => {
    queried.push(id);
    return [
      { date: '2026-09-06', eventType: 'class_day' },
      { date: '2026-09-07', eventType: 'retreat' },
      { date: id === 1 ? '2026-09-14' : '2026-09-08', eventType: 'class_day' },
    ];
  } });
  assert.deepEqual(queried, [1, 2]);
  assert.deepEqual(cards.map(item => item.id), [2, 1]);
  assert.equal(cards[0].href, '/admin/classes/2?date=2026-09-08#class-attendance');
});

test('past or missing schedules do not invent an upcoming date', async () => {
  const cards = await getDashboardClasses({ ...options, getSchedule: async id => id === 1 ? [{ date: '2026-01-01' }] : [] });
  assert.ok(cards.every(item => item.nextDate === null && !item.href.includes('?date=')));
});

test('other roles and unassigned teachers never query schedules', async () => {
  const getSchedule = () => { throw new Error('Unexpected schedule query'); };
  for (const role of ['admin', 'parent']) {
    assert.equal(await getDashboardClasses({ ...options, user: { id: 7, role }, getSchedule }), null);
  }
  assert.deepEqual(await getDashboardClasses({ ...options, user: { id: 100, role: 'catechist' }, getSchedule }), []);
});
