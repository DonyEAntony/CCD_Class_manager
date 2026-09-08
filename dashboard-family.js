async function getFamilyNextClasses({ user, children, getSchedule, formatDate, today }) {
  if (!user || ['admin', 'catechist', 'family_faith_leader'].includes(user.role)) return null;
  const groups = new Map();
  for (const child of children) {
    const reg = child.reg;
    if (String(reg.user_id) !== String(user.id) || reg.archived_at ||
        !['admitted', 'conditionally_accepted'].includes(reg.status) || !child.assignedClass) continue;
    const cls = child.assignedClass;
    if (!groups.has(cls.id)) groups.set(cls.id, { id: cls.id, label: `${child.gradeLabel || ''}${cls.sectionLabel || ''}`, time: cls.class_time, room: cls.classroom, children: [] });
    groups.get(cls.id).children.push({ name: reg.student_full_name, conditional: reg.status === 'conditionally_accepted' });
  }
  const classes = await Promise.all([...groups.values()].map(async (item) => {
    const schedule = await getSchedule(item.id);
    const date = schedule.filter((session) => !session.eventType || session.eventType === 'class_day')
      .map((session) => formatDate(session.date)).filter((date) => date >= today).sort()[0];
    return { ...item, date };
  }));
  const nextDate = classes.map((item) => item.date).filter(Boolean).sort()[0];
  return { hasClasses: groups.size > 0, date: nextDate || null, classes: nextDate ? classes.filter((item) => item.date === nextDate) : [] };
}
module.exports = { getFamilyNextClasses };
