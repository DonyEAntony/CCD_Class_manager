const Database = require('better-sqlite3');

const db = new Database('ccd.db');
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT,
    role TEXT NOT NULL DEFAULT 'parent',
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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
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

ensureColumn('student_registrations', 'primary_contact_phone', 'TEXT');
ensureColumn('student_registrations', 'primary_contact_email', 'TEXT');
ensureColumn('student_registrations', 'primary_contact_relationship', 'TEXT');
ensureColumn('student_registrations', 'primary_contact_relationship_other', 'TEXT');

module.exports = db;
