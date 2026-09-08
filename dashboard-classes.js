async function getDashboardClasses({ user, classes, getSchedule, formatDate, label, today }) {
  if (!user || !['catechist', 'family_faith_leader'].includes(user.role)) return null;
  const assigned = classes.filter((item) => (item.catechists || []).some((person) => Number(person.id) === Number(user.id)));
  const cards = await Promise.all(assigned.map(async (item) => {
    const schedule = await getSchedule(item.id);
    const nextDate = schedule.filter((session) => !session.eventType || session.eventType === 'class_day')
      .map((session) => formatDate(session.date)).filter((date) => date >= today).sort()[0] || null;
    return { id: item.id, label: label(item), time: item.class_time, room: item.classroom, nextDate,
      href: `/admin/classes/${item.id}${nextDate ? `?date=${nextDate}#class-attendance` : ''}` };
  }));
  return cards.sort((a, b) => (a.nextDate || '9999').localeCompare(b.nextDate || '9999') || a.label.localeCompare(b.label));
}
module.exports = { getDashboardClasses };
