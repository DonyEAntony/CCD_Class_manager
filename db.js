const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const dbPath = process.env.DB_PATH || 'ccd.db';
const dbDir = path.dirname(dbPath);
if (dbDir && dbDir !== '.') {
  fs.mkdirSync(dbDir, { recursive: true });
}
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT,
    role TEXT NOT NULL DEFAULT 'user',
    provider TEXT NOT NULL DEFAULT 'local',
    provider_id TEXT,
    full_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS student_registrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    school_year TEXT NOT NULL,
    parent_name TEXT,
    primary_contact_phone TEXT,
    primary_contact_email TEXT,
    primary_contact_relationship TEXT,
    primary_contact_relationship_other TEXT,
    address TEXT,
    city_state_zip TEXT,
    home_phone TEXT,
    father_name TEXT,
    father_religion TEXT,
    father_cell TEXT,
    mother_maiden_name TEXT,
    mother_religion TEXT,
    mother_cell TEXT,
    child_lives_with TEXT,
    step_parent_name TEXT,
    step_parent_religion TEXT,
    student_full_name TEXT NOT NULL,
    student_gender TEXT,
    student_age INTEGER,
    student_dob TEXT,
    child_place_of_birth TEXT,
    ccd_grade_level TEXT,
    school_attending TEXT,
    school_grade_level TEXT,
    baptism_date TEXT,
    baptism_church TEXT,
    first_communion_date TEXT,
    first_communion_church TEXT,
    disabilities_comments TEXT,
    parent_signature TEXT,
    email TEXT,
    registration_fee INTEGER,
    sacramental_fee INTEGER,
    late_fee INTEGER,
    baptism_certificate_path TEXT,
    first_communion_certificate_path TEXT,
    status TEXT DEFAULT 'in_progress',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS adult_registrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    program_type TEXT NOT NULL,
    full_name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    address TEXT,
    city_state_zip TEXT,
    dob TEXT,
    baptized TEXT,
    baptism_church TEXT,
    spouse_name TEXT,
    godparent_for TEXT,
    comments TEXT,
    class_schedule_id INTEGER,
    class_date TEXT,
    status TEXT DEFAULT 'in_progress',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS ccd_classes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    grade_level TEXT NOT NULL UNIQUE,
    class_time TEXT,
    classroom TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS faith_formation_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    audience TEXT NOT NULL,
    event_date TEXT,
    event_time TEXT,
    location TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS faith_formation_event_definitions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    audience TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS faith_formation_event_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_definition_id INTEGER NOT NULL,
    schedule_type TEXT NOT NULL DEFAULT 'one_time',
    recurrence_pattern TEXT,
    event_date TEXT,
    event_time TEXT,
    event_end_time TEXT,
    location TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (event_definition_id) REFERENCES faith_formation_event_definitions(id)
  );
`);

const columnExists = (table, column) => {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  return columns.some((c) => c.name === column);
};

const ensureColumn = (table, column, definition) => {
  if (!columnExists(table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
};

// student_registrations columns
ensureColumn('users', 'first_name', 'TEXT');
ensureColumn('users', 'last_name', 'TEXT');
ensureColumn('users', 'phone', 'TEXT');
ensureColumn('student_registrations', 'primary_contact_phone', 'TEXT');
ensureColumn('student_registrations', 'primary_contact_email', 'TEXT');
ensureColumn('student_registrations', 'primary_contact_relationship', 'TEXT');
ensureColumn('student_registrations', 'primary_contact_relationship_other', 'TEXT');
ensureColumn('student_registrations', 'primary_contact_first_name', 'TEXT');
ensureColumn('student_registrations', 'primary_contact_last_name', 'TEXT');
ensureColumn('student_registrations', 'child_place_of_birth_city', 'TEXT');
ensureColumn('student_registrations', 'child_place_of_birth_country', 'TEXT');
ensureColumn('student_registrations', 'status', "TEXT DEFAULT 'in_progress'");
ensureColumn('users', 'is_active', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('users', 'email_verified_at', 'TEXT');
ensureColumn('users', 'email_verification_token', 'TEXT');
ensureColumn('users', 'email_verification_expires_at', 'TEXT');

// adult_registrations — new unified schema columns
ensureColumn('adult_registrations', 'program_type', "TEXT NOT NULL DEFAULT 'ocia'");
ensureColumn('adult_registrations', 'address', 'TEXT');
ensureColumn('adult_registrations', 'city_state_zip', 'TEXT');
ensureColumn('adult_registrations', 'dob', 'TEXT');
ensureColumn('adult_registrations', 'baptized', 'TEXT');
ensureColumn('adult_registrations', 'baptism_church', 'TEXT');
ensureColumn('adult_registrations', 'spouse_name', 'TEXT');
ensureColumn('adult_registrations', 'godparent_for', 'TEXT');
ensureColumn('adult_registrations', 'class_schedule_id', 'INTEGER');
ensureColumn('adult_registrations', 'class_date', 'TEXT');
ensureColumn('adult_registrations', 'status', "TEXT DEFAULT 'in_progress'");
ensureColumn('faith_formation_event_schedules', 'schedule_type', "TEXT DEFAULT 'one_time'");
ensureColumn('faith_formation_event_schedules', 'recurrence_pattern', 'TEXT');
ensureColumn('faith_formation_event_schedules', 'event_end_time', 'TEXT');

// Migrate any existing 'parent' roles to 'user'
db.prepare("UPDATE users SET role = 'user' WHERE role = 'parent'").run();
db.prepare("UPDATE student_registrations SET status = 'in_progress' WHERE status = 'application'").run();
db.prepare("UPDATE adult_registrations SET status = 'in_progress' WHERE status = 'application'").run();

// Seed sample data if tables are empty
const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
const ccdClassCount = db.prepare('SELECT COUNT(*) as count FROM ccd_classes').get().count;
const faithFormationEventCount = db.prepare('SELECT COUNT(*) as count FROM faith_formation_events').get().count;
const faithFormationEventDefinitionCount = db.prepare('SELECT COUNT(*) as count FROM faith_formation_event_definitions').get().count;
if (ccdClassCount === 0) {
  const insertCcdClass = db.prepare('INSERT INTO ccd_classes (grade_level, class_time, classroom) VALUES (?, ?, ?)');
  insertCcdClass.run('1st Grade', '9:00 AM', 'Room 101');
  insertCcdClass.run('2nd Grade', '10:30 AM', 'Room 102');
}

if (faithFormationEventCount === 0) {
  const insertEvent = db.prepare(
    'INSERT INTO faith_formation_events (title, audience, event_date, event_time, location) VALUES (?, ?, ?, ?, ?)'
  );
  insertEvent.run('Parent Orientation', 'general', '2026-04-05', '18:30', 'Parish Center');
  insertEvent.run('OCIA Welcome Session', 'ocia', '2026-04-14', '19:00', 'Conference Room');
}

if (faithFormationEventDefinitionCount === 0) {
  const legacyEvents = db.prepare(
    'SELECT title, audience, event_date, event_time, location FROM faith_formation_events ORDER BY created_at ASC, id ASC'
  ).all();
  const insertDefinition = db.prepare(
    'INSERT INTO faith_formation_event_definitions (title, audience) VALUES (?, ?)'
  );
  const insertSchedule = db.prepare(
    'INSERT INTO faith_formation_event_schedules (event_definition_id, schedule_type, recurrence_pattern, event_date, event_time, event_end_time, location) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );

  legacyEvents.forEach((eventItem) => {
    const definition = insertDefinition.run(eventItem.title, eventItem.audience);
    insertSchedule.run(definition.lastInsertRowid, 'one_time', null, eventItem.event_date || null, eventItem.event_time || null, null, eventItem.location || null);
  });
}

if (userCount === 0) {
  // Insert sample users
  const insertUser = db.prepare('INSERT INTO users (email, password_hash, full_name, role) VALUES (?, ?, ?, ?)');
  insertUser.run('admin@example.com', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Admin User', 'admin');
  insertUser.run('user1@example.com', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'John Doe', 'user');
  insertUser.run('user2@example.com', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Jane Smith', 'user');

  // Get user IDs
  const adminId = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@example.com').id;
  const user1Id = db.prepare('SELECT id FROM users WHERE email = ?').get('user1@example.com').id;
  const user2Id = db.prepare('SELECT id FROM users WHERE email = ?').get('user2@example.com').id;

  // Insert sample student registrations
  const insertStudent = db.prepare(`
    INSERT INTO student_registrations (
      user_id, school_year, parent_name, primary_contact_phone, primary_contact_email,
      primary_contact_relationship, address, city_state_zip, student_full_name, student_gender,
      student_age, ccd_grade_level, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertStudent.run(user1Id, '2025-2026', 'John Doe', '123-456-7890', 'user1@example.com', 'Father', '123 Main St', 'Anytown, CA 12345', 'Johnny Doe', 'Male', 10, '4th Grade', 'in_progress');
  insertStudent.run(user2Id, '2025-2026', 'Jane Smith', '987-654-3210', 'user2@example.com', 'Mother', '456 Oak Ave', 'Somewhere, NY 67890', 'Jenny Smith', 'Female', 8, '2nd Grade', 'conditionally_accepted');

  // Insert sample adult registrations
  const insertAdult = db.prepare(`
    INSERT INTO adult_registrations (
      user_id, program_type, full_name, email, phone, address, city_state_zip, class_date, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertAdult.run(user1Id, 'ocia', 'John Doe', 'user1@example.com', '123-456-7890', '123 Main St', 'Anytown, CA 12345', null, 'completed');
  insertAdult.run(user2Id, 'baptism_prep', 'Jane Smith', 'user2@example.com', '987-654-3210', '456 Oak Ave', 'Somewhere, NY 67890', '2026-04-12', 'in_progress');
}

module.exports = db;
