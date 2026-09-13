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

test('class message recipients include a registration\'s secondary email, not just its primary contact', () => {
  const fs = require('fs');
  const vm = require('vm');
  const source = fs.readFileSync(require.resolve('../app'), 'utf8');
  const start = source.indexOf('    const recipientsByEmail = new Map();');
  const end = source.indexOf('\n\n', start);
  const selectedStudents = [
    // Both fields set, genuinely different addresses — both should be recipients.
    { primary_contact_email: 'primaryA@example.test', email: 'secondaryA@example.test' },
    // Both fields set but they're the same address (any-case) — one recipient, not two.
    { primary_contact_email: 'same@example.test', email: 'SAME@example.test' },
    // Only the secondary field is set — still a recipient (previously dropped entirely).
    { primary_contact_email: '', email: 'onlysecondary@example.test' },
    // Adult/family-faith roster rows never set r.email at all — no crash, no phantom entry.
    { primary_contact_email: 'adult@example.test' },
    // Neither set — contributes nothing.
    { primary_contact_email: '', email: '' },
  ];
  const result = vm.runInNewContext(`${source.slice(start, end)}\nArray.from(recipientsByEmail.values()).sort();`, {
    selectedStudents, includeAccountEmail: false, accountEmailByUserId: new Map(),
  });
  assert.deepEqual(Array.from(result), [
    'SAME@example.test', 'adult@example.test', 'onlysecondary@example.test', 'primaryA@example.test', 'secondaryA@example.test',
  ]);
});

test('class message recipients add the registering account\'s email only when that option is on', () => {
  const fs = require('fs');
  const vm = require('vm');
  const source = fs.readFileSync(require.resolve('../app'), 'utf8');
  const start = source.indexOf('    const recipientsByEmail = new Map();');
  const end = source.indexOf('\n\n', start);
  const selectedStudents = [
    // Account email differs from both contact fields — only picked up when opted in.
    { user_id: 1, primary_contact_email: 'contact@example.test', email: '' },
    // Account email happens to equal the primary contact — collapses to one entry.
    { user_id: 2, primary_contact_email: 'same-as-account@example.test', email: '' },
    // No contact email at all, but the account has one — this student is only reachable
    // when the option is on.
    { user_id: 3, primary_contact_email: '', email: '' },
    // No matching users row for this id at all — no crash, no phantom entry.
    { user_id: 999, primary_contact_email: 'orphan@example.test', email: '' },
  ];
  const accountEmailByUserId = new Map([
    [1, 'account1@example.test'],
    [2, 'same-as-account@example.test'],
    [3, 'account3@example.test'],
  ]);

  const off = vm.runInNewContext(`${source.slice(start, end)}\nArray.from(recipientsByEmail.values()).sort();`, {
    selectedStudents, includeAccountEmail: false, accountEmailByUserId,
  });
  assert.deepEqual(Array.from(off), ['contact@example.test', 'orphan@example.test', 'same-as-account@example.test']);

  const on = vm.runInNewContext(`${source.slice(start, end)}\nArray.from(recipientsByEmail.values()).sort();`, {
    selectedStudents, includeAccountEmail: true, accountEmailByUserId,
  });
  assert.deepEqual(Array.from(on), [
    'account1@example.test', 'account3@example.test', 'contact@example.test', 'orphan@example.test', 'same-as-account@example.test',
  ]);
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

test('getClassRoster prefers ccd_class_id over a possibly-stale preferred_class_time label', () => {
  const fs = require('fs');
  const vm = require('vm');
  const source = fs.readFileSync(require.resolve('../app'), 'utf8');
  const start = source.indexOf('const getClassRoster = (ccdClass');
  const end = source.indexOf('\n};', start) + 3;
  const getClassRoster = vm.runInNewContext(`${source.slice(start, end)}\ngetClassRoster;`, {
    resolveCcdGrade: (reg) => reg.grade_level,
    SACRAMENTAL_GRADE_LEVELS: new Set(['9']),
    getClassSlotValue: (c) => (c.classroom ? `${c.class_time} — ${c.classroom}` : c.class_time),
  });

  const ccdClass = { id: 42, grade_level: '9', class_time: 'Sunday 10am', classroom: 'Room B' };
  const enrolledRegistrationIds = new Set([1, 2, 3]);

  // Renaming a class's time/room after students registered used to silently drop them
  // from the roster (the original bug). Once ccd_class_id is set it wins outright, so a
  // stale preferred_class_time no longer matters.
  const idMatch = { id: 1, grade_level: '9', status: 'admitted', ccd_class_id: 42, preferred_class_time: 'Sunday 9am (old room)' };
  assert.deepEqual(getClassRoster(ccdClass, [idMatch], enrolledRegistrationIds), [idMatch]);

  // Rows that predate the ccd_class_id column (never backfilled) keep matching by the
  // old string comparison — no regression for them.
  const stringMatch = { id: 2, grade_level: '9', status: 'admitted', ccd_class_id: null, preferred_class_time: 'Sunday 10am — Room B' };
  assert.deepEqual(getClassRoster(ccdClass, [stringMatch], enrolledRegistrationIds), [stringMatch]);

  // ccd_class_id pointing at a different class wins outright even if the stale string
  // happens to still match this class's current text.
  const idElsewhere = { id: 3, grade_level: '9', status: 'admitted', ccd_class_id: 99, preferred_class_time: 'Sunday 10am — Room B' };
  assert.deepEqual(getClassRoster(ccdClass, [idElsewhere], enrolledRegistrationIds), []);
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
