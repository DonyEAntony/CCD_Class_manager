const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getDashboardClasses } = require('../dashboard-classes');

test('class messages accept selected combined-class students and exclude unrelated rosters', () => {
  const fs = require('fs');
  const vm = require('vm');
  const source = fs.readFileSync(require.resolve('../app'), 'utf8');
  const partnerStart = source.indexOf('const getCombinedPartnerClass =');
  const partnerEnd = source.indexOf('\n};', partnerStart) + 3;
  const selectionStart = source.indexOf('    const messageClasses =');
  const selectionEnd = source.indexOf('\n\n', selectionStart);
  for (const reverse of [false, true]) {
    const classes = [{ id: 7 }, { id: 8 }, { id: 9 }];
    classes[reverse ? 1 : 0].combinedWithClassId = reverse ? 7 : 8;
    const result = vm.runInNewContext(`${source.slice(partnerStart, partnerEnd)}
      ${source.slice(selectionStart, selectionEnd)}
      selectedStudents.map(row => row.id);`, {
      ccdClass: classes[0], ccdClasses: classes, selectedIds: new Set([70, 80, 90]),
      activeStudentRegs: [], enrolledRegistrationIds: new Set(), activeAdultRegs: [], activeFamilyFaithRegs: [],
      getClassRoster: c => [{ id: c.id * 10 }, { id: c.id * 10 + 1 }],
    });
    assert.deepEqual(Array.from(result), [70, 80]);
  }
});

test('resolveCombinedRosterOwner attributes attendance/table writes to the student\'s real class', () => {
  const fs = require('fs');
  const vm = require('vm');
  const source = fs.readFileSync(require.resolve('../app'), 'utf8');
  const start = source.indexOf('const resolveCombinedRosterOwner =');
  const end = source.indexOf('\n};', start) + 3;
  const resolveCombinedRosterOwner = vm.runInNewContext(`${source.slice(start, end)}\nresolveCombinedRosterOwner;`, {
    getClassRoster: (c) => [{ id: c.id * 10 }, { id: c.id * 10 + 1 }],
  });
  const classA = { id: 7 };
  const classB = { id: 8 };

  // A student on the page's own class resolves to that class...
  assert.equal(resolveCombinedRosterOwner(70, classA, classB), classA);
  // ...but a student who only appears on the combined partner's roster resolves to the
  // partner, not the page you're viewing from — this is what stops attendance/table
  // writes from being misfiled once the classes are later uncombined.
  assert.equal(resolveCombinedRosterOwner(80, classA, classB), classB);
  // Not on either roster.
  assert.equal(resolveCombinedRosterOwner(999, classA, classB), null);
  // Not combined: only the page's own roster is a candidate.
  assert.equal(resolveCombinedRosterOwner(70, classA, null), classA);
  assert.equal(resolveCombinedRosterOwner(80, classA, null), null);
});

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
