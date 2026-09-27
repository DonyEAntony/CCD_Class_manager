const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getFamilySchedule, buildFamilyIcs, parseClassTimeRange } = require('../family-schedule');

const cls = (id, grade, extra = {}) => ({ id, grade_level: grade, class_time: 'Tuesday 4:00-5:15 PM', classroom: '12', sectionLabel: '', catechists: [{ name: 'Ms. Rivera' }], ...extra });
const child = (id, assignedClass, extra = {}) => ({ reg: { id, user_id: 1, student_full_name: `Child ${id}`, status: 'admitted', ...extra }, assignedClass, gradeLabel: 'Grade' });
const audiences = { 2: ['children', 'sacrament_day'], 7: ['teens'], 4: ['children'] };
const base = {
  user: { id: 1, role: 'user' },
  today: '2026-09-07',
  formatDate: (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : value),
  audiencesFor: (grade) => audiences[grade] || [],
  getEvents: async () => [],
};

test('groups siblings per class, lists only upcoming dates in order and picks the next class day', async () => {
  const result = await getFamilySchedule({
    ...base,
    children: [child(1, cls(10, '4')), child(2, cls(10, '4')), child(3, cls(11, '7'))],
    getSchedule: async (id) => (id === 10
      ? [{ date: '2026-09-01', eventType: 'class_day' }, { date: '2026-09-15', eventType: 'class_day' }, { date: '2026-09-09', eventType: 'retreat', description: 'Fall retreat' }]
      : [{ date: '2026-09-10', eventType: 'class_day' }]),
  });
  assert.equal(result.classes.length, 2);
  assert.deepEqual(result.classes[0].children.map((c) => c.name), ['Child 1', 'Child 2']);
  assert.deepEqual(result.classes[0].catechists, ['Ms. Rivera']);
  assert.deepEqual(result.dates.map((d) => [d.date, d.kind]), [['2026-09-09', 'retreat'], ['2026-09-10', 'class_day'], ['2026-09-15', 'class_day']]);
  assert.equal(result.dates[0].location, '', 'retreats do not claim the classroom');
  assert.equal(result.dates[1].location, '12');
  assert.equal(result.classes[0].nextDate, '2026-09-15');
  assert.equal(result.nextClassDate, '2026-09-10');
});

test('shows only this family, skips archived, and lists pending or unplaced children separately', async () => {
  const result = await getFamilySchedule({
    ...base,
    children: [
      child(1, cls(10, '4'), { user_id: 2 }),
      child(2, cls(11, '4'), { archived_at: '2026-01-01' }),
      child(3, cls(12, '4'), { status: 'in_progress' }),
      child(4, null),
      child(5, cls(13, '4'), { status: 'conditionally_accepted' }),
    ],
    getSchedule: async (id) => {
      assert.equal(id, 13);
      return [];
    },
  });
  assert.deepEqual(result.classes.map((c) => c.id), [13]);
  assert.equal(result.classes[0].children[0].conditional, true);
  assert.deepEqual(result.pending.map((c) => c.name), ['Child 3', 'Child 4']);
  assert.equal(result.nextClassDate, null);
});

test('merges matching events once per family, flags sacrament day, and separates weekly events', async () => {
  let requested;
  const result = await getFamilySchedule({
    ...base,
    children: [child(1, cls(10, '2')), child(2, cls(11, '4'))],
    getSchedule: async () => [],
    getEvents: async (list) => {
      requested = list;
      return [
        { id: 1, title: 'Family Mass', audience: 'children', schedule_type: 'one_time', event_date: new Date('2026-10-04T00:00:00Z'), event_time: '10:00:00' },
        { id: 2, title: 'First Communion', audience: 'sacrament_day', schedule_type: 'one_time', event_date: new Date('2027-05-02T00:00:00Z'), event_time: '11:00:00' },
        { id: 3, title: 'Old event', audience: 'children', schedule_type: 'one_time', event_date: new Date('2026-08-01T00:00:00Z') },
        { id: 4, title: 'Children’s Mass', audience: 'children', schedule_type: 'recurring', recurrence_pattern: 'Sunday', event_time: '09:00:00' },
      ];
    },
  });
  assert.deepEqual(requested.sort(), ['children', 'sacrament_day']);
  assert.deepEqual(result.dates.map((d) => d.title), ['Family Mass', 'First Communion']);
  assert.deepEqual(result.dates[0].children, ['Child 1', 'Child 2']);
  assert.deepEqual(result.dates[1].children, ['Child 1']);
  assert.equal(result.dates[1].important, true);
  assert.deepEqual(result.recurring.map((e) => [e.title, e.weekday]), [['Children’s Mass', 'Sunday']]);
});

test('reads class time ranges typed in different ways', () => {
  assert.deepEqual(parseClassTimeRange('Tuesday 4:00-5:15 PM'), { start: 960, end: 1035 });
  assert.deepEqual(parseClassTimeRange('Sunday 11-12:15 PM'), { start: 660, end: 735 });
  assert.deepEqual(parseClassTimeRange('Wednesday 6:30 PM – 8 PM'), { start: 1110, end: 1200 });
  assert.equal(parseClassTimeRange('Tuesday evenings'), null);
});

test('calendar file has timed class days, all-day fallbacks, escaped text and CRLF lines', () => {
  const ics = buildFamilyIcs({
    dates: [
      { date: '2026-09-15', kind: 'class_day', title: '', location: '12', classId: 10, classLabel: 'Grade 4', classTime: 'Tuesday 4:00-5:15 PM', children: ['Ana', 'Luis'] },
      { date: '2026-09-20', kind: 'retreat', title: 'Bring lunch; wear shoes', location: '', classId: 10, classLabel: 'Grade 4', classTime: 'Tuesday 4:00-5:15 PM', children: ['Ana'] },
      { id: 2, date: '2027-05-02', kind: 'event', title: 'First Communion', time: '11:00:00', endTime: '', location: 'Church', children: ['Ana'] },
    ],
  }, { labels: { calendarName: 'Faith Formation', room: 'Room', kinds: { class_day: 'Class Day', retreat: 'Retreat Day' } }, now: new Date('2026-09-01T00:00:00Z') });
  assert.ok(ics.includes('\r\nDTSTART:20260915T160000\r\nDTEND:20260915T171500\r\n'));
  assert.ok(ics.includes('SUMMARY:Class Day: Grade 4'));
  assert.ok(ics.includes('LOCATION:Room 12'));
  assert.ok(ics.includes('DESCRIPTION:Ana\\, Luis'));
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20260920\r\nDTEND;VALUE=DATE:20260921'));
  assert.ok(ics.includes('DESCRIPTION:Bring lunch\\; wear shoes\\nAna'));
  assert.ok(ics.includes('DTSTART:20270502T110000\r\nDTEND:20270502T120000'));
  assert.ok(ics.includes('UID:event-2-20270502@st-matthew-ccd'));
  assert.ok(ics.split('\r\n').every((line) => Buffer.byteLength(line) <= 75));
});
