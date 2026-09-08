require('dotenv').config({ quiet: true });
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
(async () => {
  if (process.env.DB_NAME !== 'u733721250_faithformtest') throw Error('Requires designated test database');
  const db = require('../db');
  const staff = JSON.parse(fs.readFileSync('test-results/dashboard-e2e.json'));
  const password = crypto.randomBytes(18).toString('base64url');
  const email = `family-balance-${Date.now()}@example.test`;
  const account = await db.prepare("INSERT INTO users (email,password_hash,full_name,role,provider,is_active,email_verified_at) VALUES (?,?,?,'user','local',1,CURRENT_TIMESTAMP)").run(email, await bcrypt.hash(password, 10), 'Family Balance Test Parent');
  const year = (await db.prepare("SELECT setting_value FROM app_settings WHERE setting_key='current_registration_year'").get()).setting_value;
  const children = [];
  for (const [name, fee, extra] of [['Balance Test One',200,25],['Balance Test Two',0,50]]) {
    const r = await db.prepare("INSERT INTO student_registrations (user_id,school_year,parent_name,primary_contact_email,student_full_name,ccd_grade_level,status,registration_fee,sacramental_fee,late_fee) VALUES (?,?,?,?,?,'2','admitted',?,?,0)").run(account.lastInsertRowid,year,'Family Balance Test Parent',email,name,fee,extra);
    const s = await db.prepare("INSERT INTO students (student_full_name,grade_level,parent_user_id,parent_name,primary_contact_email,source_registration_id,student_status) VALUES (?,'2',?,?,?,?,'enrolled')").run(name,account.lastInsertRowid,'Family Balance Test Parent',email,r.lastInsertRowid);
    await db.prepare('UPDATE student_registrations SET student_id=? WHERE id=?').run(s.lastInsertRowid,r.lastInsertRowid);
    children.push({ registrationId: r.lastInsertRowid, studentId: s.lastInsertRowid });
  }
  fs.writeFileSync('test-results/family-balance-e2e.json',JSON.stringify({ email,password,userId:account.lastInsertRowid,children,admin:staff.users.admin,adminPassword:staff.password },null,2));
  console.log('Created a separate unpaid two-child family: $200 family registration + $75 sacramental fees.');
  process.exit(0);
})().catch(e=>{console.error(e.code||e.message);process.exit(1);});
