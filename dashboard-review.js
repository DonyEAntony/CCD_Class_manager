// Fixed categories keep dashboard counts and destination filters aligned.
const categories = [
  { key: 'child', table: 'student_registrations', name: 'student_full_name', type: 'child', status: 'in_progress', active: true },
  { key: 'conditional', table: 'student_registrations', name: 'student_full_name', type: 'child', status: 'conditionally_accepted', active: true },
  { key: 'family', table: 'family_faith_registrations', name: 'family_name', type: 'family_faith', status: 'in_progress', active: false },
];

async function getDashboardReview(db, user) {
  if (!user || user.role !== 'admin') return null;
  const groups = await Promise.all(categories.map(async (category) => {
    const where = `status = ?${category.active ? ' AND archived_at IS NULL' : ''}`;
    const count = await db.prepare(`SELECT COUNT(*) AS total FROM ${category.table} WHERE ${where}`).get(category.status);
    const rows = await db.prepare(`SELECT id, ${category.name} AS name, created_at FROM ${category.table} WHERE ${where} ORDER BY created_at ASC, id ASC LIMIT 5`).all(category.status);
    const href = `/admin/registrations?type=${category.type}&status=${category.status}&sort=submitted&dir=asc`;
    return { key: category.key, count: Number(count.total), href,
      items: rows.map((row) => ({ ...row, key: category.key, href: `${href}#registration-${category.type}-${row.id}` })) };
  }));
  const items = groups.flatMap((group) => group.items).sort((a, b) =>
    new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime() || Number(a.id) - Number(b.id)
  ).slice(0, 5);
  return { groups, items, total: groups.reduce((sum, group) => sum + group.count, 0) };
}

module.exports = { getDashboardReview };
