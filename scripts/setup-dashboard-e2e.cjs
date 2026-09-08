require('dotenv').config({ quiet: true });
const fs = require('fs');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

(async () => {
  if (process.env.DB_NAME !== 'u733721250_faithformtest') throw Error('This setup only supports the designated test database');
  const c = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  try {
    const [tables] = await c.query('SHOW TABLES');
    const names = tables.map(row => Object.values(row)[0]);
    const fixtures = ['app_settings', 'students', 'student_registrations', 'tuition_payments', 'tuition_payment_links'];
    if (names.length === fixtures.length && fixtures.every(name => names.includes(name))) {
      // Preserve the earlier minimal SQL fixtures before installing full app tables.
      await c.query('RENAME TABLE ' + fixtures.map(name => `\`${name}\` TO \`payment_fixture_${name}\``).join(', '));
    } else if (names.length && !names.includes('users')) throw Error('Unexpected test schema; no changes made');
  } finally { await c.end(); }
  const db = require('../db');
  await db.init();
  const password = crypto.randomBytes(18).toString('base64url');
  const hash = await bcrypt.hash(password, 10);
  const suffix = Date.now();
  const users = {};
  for (const [key, role] of [['admin','admin'], ['parent','user'], ['catechist','catechist'], ['leader','family_faith_leader']]) {
    const email = `${key}-${suffix}@example.test`;
    const result = await db.prepare('INSERT INTO users (email,password_hash,full_name,role,provider,is_active,email_verified_at) VALUES (?,?,?,?,?,1,CURRENT_TIMESTAMP)').run(email, hash, `Dashboard Test ${key}`, role, 'local');
    users[key] = { id: result.lastInsertRowid, email };
  }
  const yearSetting = await db.prepare("SELECT setting_value FROM app_settings WHERE setting_key='current_registration_year'").get();
  const year = yearSetting.setting_value;
  const date = new Date(Date.now() + 86400000 * 7).toISOString().slice(0,10);
  const childReg = await db.prepare(`INSERT INTO student_registrations
    (user_id,school_year,parent_name,primary_contact_email,student_full_name,ccd_grade_level,status,registration_fee,sacramental_fee,late_fee)
    VALUES (?,?,?,?,?,?,'admitted',150,0,0)`).run(users.parent.id, year, 'Dashboard Test Parent', users.parent.email, 'Dashboard Test Child', '3');
  const student = await db.prepare(`INSERT INTO students (student_full_name,grade_level,parent_user_id,parent_name,primary_contact_email,source_registration_id,student_status)
    VALUES (?,?,?,?,?,?,'enrolled')`).run('Dashboard Test Child','3',users.parent.id,'Dashboard Test Parent',users.parent.email,childReg.lastInsertRowid);
  await db.prepare('UPDATE student_registrations SET student_id=? WHERE id=?').run(student.lastInsertRowid,childReg.lastInsertRowid);
  const classes = {};
  for (const [key, grade, kind, staff] of [['child','3','children','catechist'], ['parent','family_faith','adult','leader'], ['unassigned','6','children',null]]) {
    const created = await db.prepare('INSERT INTO ccd_classes (grade_level,class_time,classroom,class_kind,source_program_type) VALUES (?,?,?,?,?)').run(grade,'Sunday 10:00–11:15 AM',`Test ${key}`,kind,kind === 'adult' ? grade : null);
    classes[key] = created.lastInsertRowid;
    await db.prepare("INSERT INTO ccd_class_session_dates (ccd_class_id,session_date,event_type) VALUES (?,?,'class_day')").run(created.lastInsertRowid,date);
    if (staff) await db.prepare('INSERT INTO ccd_class_catechists (ccd_class_id,catechist_user_id) VALUES (?,?)').run(created.lastInsertRowid,users[staff].id);
  }
  const { appendPayment, importKey } = require('../payment-ledger');
  await appendPayment(db, { key: importKey('E2E-' + suffix), transactionId: 'E2E-' + suffix, amount: 75, date, method: 'imported', recordedBy: users.admin.id }, [{ registrationId: childReg.lastInsertRowid, studentId: student.lastInsertRowid }]);
  fs.mkdirSync('test-results', { recursive: true });
  fs.writeFileSync('test-results/dashboard-e2e.json', JSON.stringify({ users, password, classes, studentId: student.lastInsertRowid, registrationId: childReg.lastInsertRowid, date }, null, 2));
  console.log('Full test schema and four verified test accounts created. Credentials saved locally in test-results/dashboard-e2e.json.');
  process.exit(0);
})().catch(error => { console.error(error.code || error.message); process.exit(1); });
