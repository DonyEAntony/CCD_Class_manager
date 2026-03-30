const mysql = require('mysql2/promise');

const dbConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'ccd_class_manager',
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
  queueLimit: 0,
};

let pool;
let initPromise;

const createDatabaseIfNeeded = async () => {
  const bootstrapConnection = await mysql.createConnection({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
  });

  try {
    await bootstrapConnection.query(`CREATE DATABASE IF NOT EXISTS \`${dbConfig.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  } finally {
    await bootstrapConnection.end();
  }
};

const columnExists = async (table, column) => {
  const [rows] = await pool.execute(
    `SELECT COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?
     LIMIT 1`,
    [dbConfig.database, table, column]
  );
  return rows.length > 0;
};

const ensureColumn = async (table, column, definition) => {
  if (!(await columnExists(table, column))) {
    await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  }
};

const seedData = async () => {
  await pool.query("UPDATE users SET role = 'user' WHERE role = 'parent'");
  await pool.query("UPDATE student_registrations SET status = 'in_progress' WHERE status = 'application'");
  await pool.query("UPDATE adult_registrations SET status = 'in_progress' WHERE status = 'application'");

  const [[userCountRow]] = await pool.query('SELECT COUNT(*) AS count FROM users');
  const [[ccdClassCountRow]] = await pool.query('SELECT COUNT(*) AS count FROM ccd_classes');
  const [[legacyEventCountRow]] = await pool.query('SELECT COUNT(*) AS count FROM faith_formation_events');
  const [[eventDefinitionCountRow]] = await pool.query('SELECT COUNT(*) AS count FROM faith_formation_event_definitions');

  if (ccdClassCountRow.count === 0) {
    await pool.execute('INSERT INTO ccd_classes (grade_level, class_time, classroom) VALUES (?, ?, ?)', ['1st Grade', '9:00 AM', 'Room 101']);
    await pool.execute('INSERT INTO ccd_classes (grade_level, class_time, classroom) VALUES (?, ?, ?)', ['2nd Grade', '10:30 AM', 'Room 102']);
  }

  if (legacyEventCountRow.count === 0) {
    await pool.execute(
      'INSERT INTO faith_formation_events (title, audience, event_date, event_time, location) VALUES (?, ?, ?, ?, ?)',
      ['Parent Orientation', 'general', '2026-04-05', '18:30', 'Parish Center']
    );
    await pool.execute(
      'INSERT INTO faith_formation_events (title, audience, event_date, event_time, location) VALUES (?, ?, ?, ?, ?)',
      ['OCIA Welcome Session', 'ocia', '2026-04-14', '19:00', 'Conference Room']
    );
  }

  if (eventDefinitionCountRow.count === 0) {
    const [legacyEvents] = await pool.query(
      'SELECT title, audience, event_date, event_time, location FROM faith_formation_events ORDER BY created_at ASC, id ASC'
    );

    for (const eventItem of legacyEvents) {
      const [definitionResult] = await pool.execute(
        'INSERT INTO faith_formation_event_definitions (title, audience) VALUES (?, ?)',
        [eventItem.title, eventItem.audience]
      );

      await pool.execute(
        `INSERT INTO faith_formation_event_schedules
          (event_definition_id, schedule_type, recurrence_pattern, event_date, event_time, event_end_time, location)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [definitionResult.insertId, 'one_time', null, eventItem.event_date || null, eventItem.event_time || null, null, eventItem.location || null]
      );
    }
  }

  if (userCountRow.count === 0) {
    await pool.execute(
      'INSERT INTO users (email, password_hash, full_name, role, provider, is_active) VALUES (?, ?, ?, ?, ?, ?)',
      ['admin@example.com', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Admin User', 'admin', 'local', 1]
    );
    await pool.execute(
      'INSERT INTO users (email, password_hash, full_name, role, provider, is_active) VALUES (?, ?, ?, ?, ?, ?)',
      ['user1@example.com', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'John Doe', 'user', 'local', 1]
    );
    await pool.execute(
      'INSERT INTO users (email, password_hash, full_name, role, provider, is_active) VALUES (?, ?, ?, ?, ?, ?)',
      ['user2@example.com', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Jane Smith', 'user', 'local', 1]
    );

    const [[adminRow]] = await pool.execute('SELECT id FROM users WHERE email = ?', ['admin@example.com']);
    const [[user1Row]] = await pool.execute('SELECT id FROM users WHERE email = ?', ['user1@example.com']);
    const [[user2Row]] = await pool.execute('SELECT id FROM users WHERE email = ?', ['user2@example.com']);

    await pool.execute(
      `INSERT INTO student_registrations (
        user_id, school_year, parent_name, primary_contact_phone, primary_contact_email,
        primary_contact_relationship, address, city_state_zip, student_full_name, student_gender,
        student_age, ccd_grade_level, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [user1Row.id, '2025-2026', 'John Doe', '123-456-7890', 'user1@example.com', 'Father', '123 Main St', 'Anytown, CA 12345', 'Johnny Doe', 'Male', 10, '4th Grade', 'in_progress']
    );
    await pool.execute(
      `INSERT INTO student_registrations (
        user_id, school_year, parent_name, primary_contact_phone, primary_contact_email,
        primary_contact_relationship, address, city_state_zip, student_full_name, student_gender,
        student_age, ccd_grade_level, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [user2Row.id, '2025-2026', 'Jane Smith', '987-654-3210', 'user2@example.com', 'Mother', '456 Oak Ave', 'Somewhere, NY 67890', 'Jenny Smith', 'Female', 8, '2nd Grade', 'conditionally_accepted']
    );

    await pool.execute(
      `INSERT INTO adult_registrations (
        user_id, program_type, full_name, email, phone, address, city_state_zip, class_date, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [user1Row.id, 'ocia', 'John Doe', 'user1@example.com', '123-456-7890', '123 Main St', 'Anytown, CA 12345', null, 'completed']
    );
    await pool.execute(
      `INSERT INTO adult_registrations (
        user_id, program_type, full_name, email, phone, address, city_state_zip, class_date, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [user2Row.id, 'baptism_prep', 'Jane Smith', 'user2@example.com', '987-654-3210', '456 Oak Ave', 'Somewhere, NY 67890', '2026-04-12', 'in_progress']
    );
  }
};

const init = async () => {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    await createDatabaseIfNeeded();
    pool = mysql.createPool(dbConfig);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash VARCHAR(255),
        role VARCHAR(50) NOT NULL DEFAULT 'user',
        provider VARCHAR(50) NOT NULL DEFAULT 'local',
        provider_id VARCHAR(255),
        full_name VARCHAR(255),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS student_registrations (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        school_year VARCHAR(32) NOT NULL,
        parent_name TEXT,
        primary_contact_phone VARCHAR(50),
        primary_contact_email VARCHAR(255),
        primary_contact_relationship VARCHAR(100),
        primary_contact_relationship_other TEXT,
        address TEXT,
        city_state_zip TEXT,
        home_phone VARCHAR(50),
        father_name VARCHAR(255),
        father_religion VARCHAR(255),
        father_cell VARCHAR(50),
        mother_maiden_name VARCHAR(255),
        mother_religion VARCHAR(255),
        mother_cell VARCHAR(50),
        child_lives_with VARCHAR(255),
        step_parent_name VARCHAR(255),
        step_parent_religion VARCHAR(255),
        student_full_name TEXT NOT NULL,
        student_gender VARCHAR(50),
        student_age INT,
        student_dob TEXT,
        child_place_of_birth TEXT,
        ccd_grade_level VARCHAR(255),
        school_attending VARCHAR(255),
        school_grade_level VARCHAR(255),
        baptism_date TEXT,
        baptism_church TEXT,
        first_communion_date TEXT,
        first_communion_church TEXT,
        disabilities_comments TEXT,
        parent_signature TEXT,
        email VARCHAR(255),
        registration_fee INT,
        sacramental_fee INT,
        late_fee INT,
        baptism_certificate_path TEXT,
        first_communion_certificate_path TEXT,
        status VARCHAR(50) DEFAULT 'in_progress',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_student_registrations_user FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS adult_registrations (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        program_type VARCHAR(100) NOT NULL,
        full_name VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        phone VARCHAR(50),
        address TEXT,
        city_state_zip TEXT,
        dob TEXT,
        baptized VARCHAR(100),
        baptism_church TEXT,
        spouse_name VARCHAR(255),
        godparent_for VARCHAR(255),
        comments TEXT,
        class_schedule_id INT,
        class_date TEXT,
        status VARCHAR(50) DEFAULT 'in_progress',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_adult_registrations_user FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS family_faith_registrations (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        school_year VARCHAR(32) NOT NULL,
        family_name VARCHAR(255) NOT NULL,
        primary_contact_name VARCHAR(255) NOT NULL,
        primary_contact_email VARCHAR(255),
        primary_contact_phone VARCHAR(50),
        address TEXT,
        city_state_zip TEXT,
        notes TEXT,
        assigned_leader_user_id INT NULL,
        visit_slot_id INT NULL,
        visit_start DATETIME NULL,
        visit_end DATETIME NULL,
        visit_label VARCHAR(255) NULL,
        members_json LONGTEXT NOT NULL,
        status VARCHAR(50) DEFAULT 'in_progress',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_family_faith_registrations_user FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS family_faith_visit_slots (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        leader_user_id INT NOT NULL,
        slot_start DATETIME NOT NULL,
        slot_end DATETIME NOT NULL,
        booked_registration_id INT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_family_faith_visit_slots_user FOREIGN KEY (leader_user_id) REFERENCES users(id)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ccd_classes (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        grade_level VARCHAR(255) NOT NULL UNIQUE,
        class_time VARCHAR(255),
        classroom VARCHAR(255),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS faith_formation_events (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        audience VARCHAR(100) NOT NULL,
        event_date DATE,
        event_time VARCHAR(50),
        location VARCHAR(255),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS faith_formation_event_definitions (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        audience VARCHAR(100) NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS faith_formation_event_schedules (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        event_definition_id INT NOT NULL,
        schedule_type VARCHAR(50) NOT NULL DEFAULT 'one_time',
        recurrence_pattern VARCHAR(50),
        event_date DATE,
        event_time VARCHAR(50),
        event_end_time VARCHAR(50),
        location VARCHAR(255),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_event_schedules_definition FOREIGN KEY (event_definition_id) REFERENCES faith_formation_event_definitions(id)
      )
    `);

    await ensureColumn('users', 'first_name', 'VARCHAR(255)');
    await ensureColumn('users', 'last_name', 'VARCHAR(255)');
    await ensureColumn('users', 'phone', 'VARCHAR(50)');
    await ensureColumn('users', 'is_active', 'TINYINT(1) NOT NULL DEFAULT 1');
    await ensureColumn('users', 'email_verified_at', 'DATETIME NULL');
    await ensureColumn('users', 'email_verification_token', 'VARCHAR(255) NULL');
    await ensureColumn('users', 'email_verification_expires_at', 'DATETIME NULL');
    await ensureColumn('ccd_classes', 'catechist_user_id', 'INT NULL');

    await ensureColumn('student_registrations', 'primary_contact_first_name', 'VARCHAR(255)');
    await ensureColumn('student_registrations', 'primary_contact_last_name', 'VARCHAR(255)');
    await ensureColumn('student_registrations', 'child_place_of_birth_city', 'TEXT');
    await ensureColumn('student_registrations', 'child_place_of_birth_country', 'TEXT');

    await ensureColumn('adult_registrations', 'address', 'TEXT');
    await ensureColumn('adult_registrations', 'city_state_zip', 'TEXT');
    await ensureColumn('adult_registrations', 'dob', 'TEXT');
    await ensureColumn('adult_registrations', 'baptized', 'VARCHAR(100)');
    await ensureColumn('adult_registrations', 'baptism_church', 'TEXT');
    await ensureColumn('adult_registrations', 'spouse_name', 'VARCHAR(255)');
    await ensureColumn('adult_registrations', 'godparent_for', 'VARCHAR(255)');
    await ensureColumn('adult_registrations', 'class_schedule_id', 'INT NULL');
    await ensureColumn('adult_registrations', 'class_date', 'TEXT');
    await ensureColumn('adult_registrations', 'status', "VARCHAR(50) DEFAULT 'in_progress'");

    await ensureColumn('family_faith_registrations', 'primary_contact_email', 'VARCHAR(255)');
    await ensureColumn('family_faith_registrations', 'primary_contact_phone', 'VARCHAR(50)');
    await ensureColumn('family_faith_registrations', 'address', 'TEXT');
    await ensureColumn('family_faith_registrations', 'city_state_zip', 'TEXT');
    await ensureColumn('family_faith_registrations', 'notes', 'TEXT');
    await ensureColumn('family_faith_registrations', 'assigned_leader_user_id', 'INT NULL');
    await ensureColumn('family_faith_registrations', 'visit_slot_id', 'INT NULL');
    await ensureColumn('family_faith_registrations', 'visit_start', 'DATETIME NULL');
    await ensureColumn('family_faith_registrations', 'visit_end', 'DATETIME NULL');
    await ensureColumn('family_faith_registrations', 'visit_label', 'VARCHAR(255) NULL');
    await ensureColumn('family_faith_registrations', 'status', "VARCHAR(50) DEFAULT 'in_progress'");

    await ensureColumn('faith_formation_event_schedules', 'schedule_type', "VARCHAR(50) DEFAULT 'one_time'");
    await ensureColumn('faith_formation_event_schedules', 'recurrence_pattern', 'VARCHAR(50)');
    await ensureColumn('faith_formation_event_schedules', 'event_end_time', 'VARCHAR(50)');

    await seedData();
  })();

  return initPromise;
};

const prepare = (sql) => ({
  async get(...params) {
    await init();
    const [rows] = await pool.execute(sql, params);
    return rows[0];
  },
  async all(...params) {
    await init();
    const [rows] = await pool.execute(sql, params);
    return rows;
  },
  async run(...params) {
    await init();
    const [result] = await pool.execute(sql, params);
    return {
      changes: result.affectedRows || 0,
      lastInsertRowid: result.insertId || 0,
    };
  },
});

module.exports = {
  init,
  prepare,
};
