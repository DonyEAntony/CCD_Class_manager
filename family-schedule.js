// Parent-facing "My Family's Schedule" (GET /my-family, also the installed phone app's
// start page): each of the family's children's classes plus every upcoming date that
// matters to them — class days, retreats, rehearsals, Masses, and the Faith Formation
// Events whose audience matches a child's grade — as one date-ordered list. Database
// lookups are injected so the grouping rules stay testable without MySQL.
const ACCEPTED_STATUSES = ['admitted', 'conditionally_accepted'];
const PENDING_STATUSES = ['in_progress'];

async function getFamilySchedule({ user, children, getSchedule, getEvents, audiencesFor, formatDate, today }) {
  const mine = children.filter((child) => String(child.reg.user_id) === String(user.id) && !child.reg.archived_at);
  const pending = mine
    .filter((child) => PENDING_STATUSES.includes(child.reg.status) || (ACCEPTED_STATUSES.includes(child.reg.status) && !child.assignedClass))
    .map((child) => ({ name: child.reg.student_full_name, gradeLabel: child.gradeLabel || null }));

  const groups = new Map();
  mine.filter((child) => ACCEPTED_STATUSES.includes(child.reg.status) && child.assignedClass).forEach((child) => {
    const cls = child.assignedClass;
    if (!groups.has(cls.id)) {
      groups.set(cls.id, {
        id: cls.id,
        gradeLevel: cls.grade_level,
        label: [child.gradeLabel, cls.sectionLabel].filter(Boolean).join(' '),
        time: cls.class_time || '',
        room: cls.classroom || '',
        catechists: (cls.catechists || []).map((catechist) => catechist.name).filter(Boolean),
        children: [],
      });
    }
    groups.get(cls.id).children.push({ name: child.reg.student_full_name, conditional: child.reg.status === 'conditionally_accepted' });
  });
  const classes = [...groups.values()];

  const dates = [];
  await Promise.all(classes.map(async (cls) => {
    const childNames = cls.children.map((child) => child.name);
    (await getSchedule(cls.id)).forEach((session) => {
      const date = formatDate(session.date);
      if (date < today) return;
      const kind = session.eventType || 'class_day';
      // Retreats, rehearsals and Masses can meet elsewhere, so only class days name the room.
      dates.push({ date, kind, title: session.description || '', time: '', location: kind === 'class_day' ? cls.room : '', classId: cls.id, classLabel: cls.label, classTime: cls.time, children: childNames, important: false });
    });
    cls.nextDate = dates.filter((entry) => entry.classId === cls.id && entry.kind === 'class_day').map((entry) => entry.date).sort()[0] || null;
  }));

  // One event can match several children (e.g. a Teen Mass for a Grade 7 and a
  // Confirmation sibling) — listed once, naming every child it applies to.
  const childrenByAudience = new Map();
  classes.forEach((cls) => audiencesFor(cls.gradeLevel).forEach((audience) => {
    if (!childrenByAudience.has(audience)) childrenByAudience.set(audience, new Set());
    cls.children.forEach((child) => childrenByAudience.get(audience).add(child.name));
  }));
  const events = childrenByAudience.size ? await getEvents([...childrenByAudience.keys()]) : [];
  const eventsById = new Map();
  events.forEach((event) => {
    const existing = eventsById.get(event.id);
    const names = childrenByAudience.get(event.audience) || new Set();
    if (existing) names.forEach((name) => existing.children.add(name));
    else eventsById.set(event.id, { ...event, children: new Set(names) });
  });

  const recurring = [];
  eventsById.forEach((event) => {
    const base = { title: event.title, time: event.event_time || '', endTime: event.event_end_time || '', location: event.location || '', children: [...event.children], important: event.audience === 'sacrament_day' };
    if (event.schedule_type === 'recurring') {
      // A weekly event would bury the one-time dates, so it's shown once as "every <day>".
      if (event.recurrence_pattern) recurring.push({ ...base, weekday: event.recurrence_pattern });
      return;
    }
    if (!event.event_date) return;
    const date = formatDate(new Date(event.event_date));
    if (date < today) return;
    dates.push({ ...base, id: event.id, date, kind: 'event' });
  });

  dates.sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || '') || (a.classLabel || a.title).localeCompare(b.classLabel || b.title));
  const nextClassDate = classes.map((cls) => cls.nextDate).filter(Boolean).sort()[0] || null;
  return { classes, dates, recurring, pending, nextClassDate };
}

// class_time is free text ("Tuesday 4:00-5:15 PM"); a start meridiem left off is taken
// from the end time unless that would put the start after the end ("11-12:15 PM").
const parseClassTimeRange = (text) => {
  const match = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*[-–]\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i.exec(text || '');
  if (!match) return null;
  const to24 = (hour, meridiem) => (Number(hour) % 12) + (meridiem.toLowerCase() === 'pm' ? 12 : 0);
  const endMinutes = (to24(match[4], match[6]) * 60) + Number(match[5] || 0);
  let startMinutes = (to24(match[1], match[3] || match[6]) * 60) + Number(match[2] || 0);
  if (!match[3] && startMinutes > endMinutes) startMinutes -= 12 * 60;
  if (startMinutes < 0 || startMinutes >= endMinutes) return null;
  return { start: startMinutes, end: endMinutes };
};

const escapeIcsText = (value) => String(value || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// RFC 5545 caps content lines at 75 octets; longer ones continue on a line starting with a space.
const foldIcsLine = (line) => {
  const parts = [];
  let current = '';
  for (const char of line) {
    if (Buffer.byteLength(current + char) > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = '';
    }
    current += char;
  }
  parts.push(current);
  return parts.join('\r\n ');
};

const icsDate = (date) => date.replace(/-/g, '');
const icsDateTime = (date, minutes) => `${icsDate(date)}T${String(Math.floor(minutes / 60)).padStart(2, '0')}${String(minutes % 60).padStart(2, '0')}00`;
const timeToMinutes = (value) => {
  const match = /^(\d{1,2}):(\d{2})/.exec(value || '');
  return match ? (Number(match[1]) * 60) + Number(match[2]) : null;
};
const nextDay = (date) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
};

// "Add to my phone's calendar" download. Times are floating (no time zone) so they read
// as parish-local wall-clock times; dates without a known time become all-day entries.
function buildFamilyIcs(schedule, { labels, now = new Date() }) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//St Matthew Faith Formation//Family Schedule//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${escapeIcsText(labels.calendarName)}`];
  schedule.dates.forEach((entry) => {
    let start = null;
    let end = null;
    if (entry.kind === 'event') {
      start = timeToMinutes(entry.time);
      end = timeToMinutes(entry.endTime);
      if (start != null && (end == null || end <= start)) end = start + 60;
    } else if (entry.kind === 'class_day') {
      const range = parseClassTimeRange(entry.classTime);
      if (range) ({ start, end } = range);
    }
    const summary = entry.kind === 'event'
      ? entry.title
      : `${labels.kinds[entry.kind] || labels.kinds.class_day}: ${entry.classLabel}`;
    const details = [entry.kind !== 'event' ? entry.title : '', entry.children.join(', ')].filter(Boolean).join('\n');
    lines.push('BEGIN:VEVENT', `UID:${entry.kind === 'event' ? `event-${entry.id}` : `class-${entry.classId}-${entry.kind}`}-${icsDate(entry.date)}@st-matthew-ccd`, `DTSTAMP:${stamp}`);
    if (start != null) lines.push(`DTSTART:${icsDateTime(entry.date, start)}`, `DTEND:${icsDateTime(entry.date, end)}`);
    else lines.push(`DTSTART;VALUE=DATE:${icsDate(entry.date)}`, `DTEND;VALUE=DATE:${icsDate(nextDay(entry.date))}`);
    lines.push(`SUMMARY:${escapeIcsText(summary)}`);
    if (details) lines.push(`DESCRIPTION:${escapeIcsText(details)}`);
    if (entry.location) lines.push(`LOCATION:${escapeIcsText(entry.kind === 'event' ? entry.location : `${labels.room} ${entry.location}`)}`);
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
}

module.exports = { getFamilySchedule, buildFamilyIcs, parseClassTimeRange };
