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

// Kept in sync with app.js's CCD_GRADE_BY_SACRAMENTAL_YEAR / resolveCcdGrade —
// db.js has no access to app.js's helpers, so the grade-resolution logic is
// duplicated here for the one-time backfill below.
const CCD_GRADE_BY_SACRAMENTAL_YEAR = {
  first_year_communion: '1',
  second_year_communion: '2',
  first_year_confirmation: '8',
  second_year_confirmation: '9',
};
const resolveCcdGradeForBackfill = (reg) => {
  if (reg.non_sacramental_grade) return reg.non_sacramental_grade;
  if (reg.sacramental_year && CCD_GRADE_BY_SACRAMENTAL_YEAR[reg.sacramental_year]) {
    return CCD_GRADE_BY_SACRAMENTAL_YEAR[reg.sacramental_year];
  }
  return reg.ccd_grade_level || null;
};

// One-time backfill: children registrations used to track post-admission
// student state (Completed/Discontinued/Graduated) directly on their own
// status. That state now lives on the separate `students` table so it
// survives independently of any one year's registration record. This
// creates a `students` row for every registration that needs one and never
// touches a registration that already has student_id set.
const backfillStudentRecords = async () => {
  const [legacyRows] = await pool.query(
    `SELECT * FROM student_registrations WHERE status IN ('completed', 'discontinued', 'graduated') AND student_id IS NULL`
  );
  for (const reg of legacyRows) {
    const [result] = await pool.execute(
      `INSERT INTO students (student_full_name, student_dob, student_gender, grade_level, parent_user_id, parent_name, primary_contact_email, primary_contact_phone, student_status, source_registration_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [reg.student_full_name, reg.student_dob, reg.student_gender, resolveCcdGradeForBackfill(reg), reg.user_id, reg.parent_name, reg.primary_contact_email, reg.primary_contact_phone, reg.status, reg.id]
    );
    await pool.execute('UPDATE student_registrations SET status = ?, student_id = ? WHERE id = ?', ['admitted', result.insertId, reg.id]);
  }

  const [admittedRows] = await pool.query(
    `SELECT * FROM student_registrations WHERE status = 'admitted' AND student_id IS NULL`
  );
  for (const reg of admittedRows) {
    const [result] = await pool.execute(
      `INSERT INTO students (student_full_name, student_dob, student_gender, grade_level, parent_user_id, parent_name, primary_contact_email, primary_contact_phone, student_status, source_registration_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'enrolled', ?)`,
      [reg.student_full_name, reg.student_dob, reg.student_gender, resolveCcdGradeForBackfill(reg), reg.user_id, reg.parent_name, reg.primary_contact_email, reg.primary_contact_phone, reg.id]
    );
    await pool.execute('UPDATE student_registrations SET student_id = ? WHERE id = ?', [result.insertId, reg.id]);
  }
};

const seedData = async () => {
  await pool.query("UPDATE users SET role = 'user' WHERE role = 'parent'");
  await pool.query("UPDATE student_registrations SET status = 'in_progress' WHERE status = 'application'");
  await pool.query("UPDATE adult_registrations SET status = 'in_progress' WHERE status = 'application'");
  await backfillStudentRecords();

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
      CREATE TABLE IF NOT EXISTS sessions (
        sid VARCHAR(255) NOT NULL PRIMARY KEY,
        data LONGTEXT NOT NULL,
        expires_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_sessions_expires_at (expires_at)
      )
    `);

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

    // A student's ongoing enrollment (Enrolled/Completed/Graduated/Discontinued/
    // Transferred) is tracked here, separate from student_registrations.status
    // (which only tracks the admission process for one year's registration).
    // source_registration_id uses ON DELETE SET NULL so deleting or re-doing a
    // registration never deletes the student record it produced.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS students (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        student_full_name TEXT NOT NULL,
        student_dob TEXT,
        student_gender VARCHAR(50),
        grade_level VARCHAR(255),
        parent_user_id INT NULL,
        parent_name TEXT,
        primary_contact_email VARCHAR(255),
        primary_contact_phone VARCHAR(50),
        student_status VARCHAR(30) NOT NULL DEFAULT 'enrolled',
        source_registration_id INT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_students_source_registration FOREIGN KEY (source_registration_id) REFERENCES student_registrations(id) ON DELETE SET NULL
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
      CREATE TABLE IF NOT EXISTS sponsor_confirmations (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        student_name VARCHAR(255) NOT NULL,
        confirmation_name VARCHAR(255),
        sponsor_name VARCHAR(255) NOT NULL,
        sponsor_address TEXT,
        sponsor_city VARCHAR(255),
        sponsor_state VARCHAR(50),
        sponsor_zip VARCHAR(20),
        is_st_matthew_parishioner TINYINT(1) NOT NULL DEFAULT 0,
        sponsor_certificate_path TEXT,
        admin_verified TINYINT(1) NOT NULL DEFAULT 0,
        admin_verified_at DATETIME NULL,
        student_signature VARCHAR(255),
        parent_signature VARCHAR(255),
        status VARCHAR(50) DEFAULT 'in_progress',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_sponsor_confirmations_user FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS eucharistic_adoration_signups (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        full_name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        phone VARCHAR(50) NOT NULL,
        adoration_date DATE NOT NULL,
        slot_start_time VARCHAR(10) NOT NULL,
        slot_end_time VARCHAR(10) NOT NULL,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_adoration_slot (adoration_date, slot_start_time)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS eucharistic_adoration_available_dates (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        adoration_date DATE NOT NULL,
        start_time VARCHAR(10) NOT NULL DEFAULT '08:30',
        end_time VARCHAR(10) NOT NULL DEFAULT '16:00',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_adoration_available_date (adoration_date)
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
      CREATE TABLE IF NOT EXISTS app_settings (
        setting_key VARCHAR(100) NOT NULL PRIMARY KEY,
        setting_value TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS registration_year_settings (
        school_year VARCHAR(32) NOT NULL PRIMARY KEY,
        faith_formation_open TINYINT(1) NOT NULL DEFAULT 0,
        sponsor_form_open TINYINT(1) NOT NULL DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
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
        grade_level VARCHAR(255) NOT NULL,
        class_time VARCHAR(255),
        classroom VARCHAR(255),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ccd_class_attendance (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        ccd_class_id INT NOT NULL,
        student_registration_id INT NOT NULL,
        session_date DATE NOT NULL,
        status VARCHAR(20) NOT NULL,
        marked_by INT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_class_student_date (ccd_class_id, student_registration_id, session_date),
        CONSTRAINT fk_attendance_class FOREIGN KEY (ccd_class_id) REFERENCES ccd_classes(id),
        CONSTRAINT fk_attendance_student FOREIGN KEY (student_registration_id) REFERENCES student_registrations(id)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ccd_class_catechists (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        ccd_class_id INT NOT NULL,
        catechist_user_id INT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_class_catechist (ccd_class_id, catechist_user_id),
        CONSTRAINT fk_class_catechists_class FOREIGN KEY (ccd_class_id) REFERENCES ccd_classes(id),
        CONSTRAINT fk_class_catechists_user FOREIGN KEY (catechist_user_id) REFERENCES users(id)
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
    await ensureColumn('users', 'password_reset_token', 'VARCHAR(255) NULL');
    await ensureColumn('users', 'password_reset_expires_at', 'DATETIME NULL');
    await ensureColumn('users', 'account_status', "VARCHAR(50) NOT NULL DEFAULT 'active'");
    await ensureColumn('users', 'must_change_password', 'TINYINT(1) NOT NULL DEFAULT 0');
    await ensureColumn('ccd_classes', 'section_label', 'VARCHAR(10) NULL');
    // A class can now have more than one catechist, so the single catechist_user_id
    // column moved to the ccd_class_catechists join table. Migrate any existing
    // assignment across, then drop the old column now that nothing reads it.
    try {
      if (await columnExists('ccd_classes', 'catechist_user_id')) {
        await pool.query(`
          INSERT IGNORE INTO ccd_class_catechists (ccd_class_id, catechist_user_id)
          SELECT id, catechist_user_id FROM ccd_classes WHERE catechist_user_id IS NOT NULL
        `);
        await pool.query('ALTER TABLE ccd_classes DROP COLUMN catechist_user_id');
      }
    } catch (error) {
      console.warn('[migration] Skipped ccd_classes.catechist_user_id -> ccd_class_catechists migration', error?.message || error);
    }
    // One-time normalization: legacy seed data used "1st Grade"/"2nd Grade" labels;
    // the sacramental-prep grade scheme (1-9) now expects plain digit grade_level values.
    try {
      await pool.query("UPDATE ccd_classes SET grade_level = '1' WHERE grade_level = '1st Grade'");
      await pool.query("UPDATE ccd_classes SET grade_level = '2' WHERE grade_level = '2nd Grade'");
    } catch (error) {
      console.warn('[migration] Skipped ccd_classes grade_level normalization', error?.message || error);
    }
    // A grade can now offer multiple time-slot sections (e.g. 3 options for Second
    // Year Communion), so grade_level can no longer be unique. Drop the legacy index.
    try {
      await pool.query('ALTER TABLE ccd_classes DROP INDEX grade_level');
    } catch (error) {
      // Already dropped, or the index has a different name on this install — safe to ignore.
    }
    // One-time backfill: section_label used to be computed on the fly (ordered by weekday)
    // before it became an admin-editable stored column. Seed any still-unlabeled rows
    // within a multi-section grade using that same weekday order so existing admins don't
    // lose the labels they were already seeing; going forward, admins edit this directly.
    try {
      const [unlabeledGroups] = await pool.query(`
        SELECT grade_level FROM ccd_classes
        WHERE section_label IS NULL OR section_label = ''
        GROUP BY grade_level
        HAVING COUNT(*) > 1
      `);
      for (const { grade_level: gradeLevel } of unlabeledGroups) {
        const [rows] = await pool.query(
          'SELECT id, class_time FROM ccd_classes WHERE grade_level = ? AND (section_label IS NULL OR section_label = ?)',
          [gradeLevel, '']
        );
        const weekdayIndex = (classTime) => {
          const match = String(classTime || '').trim().match(/^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)/i);
          if (!match) return 7;
          return ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(match[1].toLowerCase());
        };
        const sorted = [...rows].sort((a, b) => weekdayIndex(a.class_time) - weekdayIndex(b.class_time) || a.id - b.id);
        for (let i = 0; i < sorted.length; i++) {
          await pool.execute('UPDATE ccd_classes SET section_label = ? WHERE id = ?', [String.fromCharCode(65 + i), sorted[i].id]);
        }
      }
    } catch (error) {
      console.warn('[migration] Skipped ccd_classes section_label backfill', error?.message || error);
    }

    await ensureColumn('student_registrations', 'primary_contact_first_name', 'VARCHAR(255)');
    await ensureColumn('student_registrations', 'primary_contact_last_name', 'VARCHAR(255)');
    await ensureColumn('student_registrations', 'primary_contact_religion', 'VARCHAR(100) NULL');
    await ensureColumn('student_registrations', 'child_place_of_birth_city', 'TEXT');
    await ensureColumn('student_registrations', 'child_place_of_birth_country', 'TEXT');
    await ensureColumn('student_registrations', 'sacramental_year', 'VARCHAR(30) NULL');
    await ensureColumn('student_registrations', 'preferred_class_time', 'VARCHAR(100) NULL');
    await ensureColumn('student_registrations', 'non_sacramental_grade', 'VARCHAR(10) NULL');
    await ensureColumn('student_registrations', 'not_baptized', 'TINYINT(1) NOT NULL DEFAULT 0');
    await ensureColumn('student_registrations', 'archived_at', 'DATETIME NULL');
    await ensureColumn('student_registrations', 'certificates_verified', 'TINYINT(1) NOT NULL DEFAULT 0');
    await ensureColumn('student_registrations', 'certificates_verified_at', 'DATETIME NULL');
    await ensureColumn('student_registrations', 'certificates_verified_by', 'INT NULL');
    await ensureColumn('student_registrations', 'tuition_paid', 'TINYINT(1) NOT NULL DEFAULT 0');
    await ensureColumn('student_registrations', 'tuition_paid_at', 'DATETIME NULL');
    await ensureColumn('student_registrations', 'tuition_paid_by', 'INT NULL');
    await ensureColumn('student_registrations', 'parent_contacted', 'TINYINT(1) NOT NULL DEFAULT 0');
    await ensureColumn('student_registrations', 'parent_contacted_at', 'DATETIME NULL');
    await ensureColumn('student_registrations', 'parent_contacted_by', 'INT NULL');
    await ensureColumn('student_registrations', 'student_id', 'INT NULL');
    await ensureColumn('sponsor_confirmations', 'is_st_matthew_parishioner', 'TINYINT(1) NOT NULL DEFAULT 0');
    await ensureColumn('sponsor_confirmations', 'sponsor_certificate_path', 'TEXT');
    await ensureColumn('sponsor_confirmations', 'admin_verified', 'TINYINT(1) NOT NULL DEFAULT 0');
    await ensureColumn('sponsor_confirmations', 'admin_verified_at', 'DATETIME NULL');

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
    await ensureColumn('adult_registrations', 'archived_at', 'DATETIME NULL');

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
    await ensureColumn('eucharistic_adoration_available_dates', 'start_time', "VARCHAR(10) NOT NULL DEFAULT '08:30'");
    await ensureColumn('eucharistic_adoration_available_dates', 'end_time', "VARCHAR(10) NOT NULL DEFAULT '16:00'");

    await pool.query(`
      CREATE TABLE IF NOT EXISTS altar_server_training_dates (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        training_date DATE NOT NULL,
        training_time VARCHAR(10) NOT NULL,
        location VARCHAR(255),
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_training_date (training_date)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS altar_server_signups (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        child_first_name VARCHAR(255) NOT NULL,
        child_last_name VARCHAR(255) NOT NULL,
        child_dob TEXT,
        child_grade VARCHAR(100),
        parent_name VARCHAR(255) NOT NULL,
        parent_email VARCHAR(255) NOT NULL,
        parent_phone VARCHAR(50) NOT NULL,
        training_date_id INT NULL,
        notes TEXT,
        status VARCHAR(50) DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_altar_server_signups_training_date FOREIGN KEY (training_date_id) REFERENCES altar_server_training_dates(id) ON DELETE SET NULL
      )
    `);

    await pool.query(`
      UPDATE eucharistic_adoration_available_dates
      SET start_time = COALESCE(NULLIF(start_time, ''), '08:30'),
          end_time = COALESCE(NULLIF(end_time, ''), '16:00')
    `);

    await pool.execute(
      `INSERT INTO app_settings (setting_key, setting_value)
       VALUES ('faith_formation_year', ?)
       ON DUPLICATE KEY UPDATE setting_value = setting_value`,
      ['2025-2026']
    );
    await pool.execute(
      `INSERT INTO app_settings (setting_key, setting_value)
       VALUES ('current_registration_year', ?)
       ON DUPLICATE KEY UPDATE setting_value = setting_value`,
      ['2025-2026']
    );
    await pool.execute(
      `INSERT INTO app_settings (setting_key, setting_value)
       VALUES ('faith_formation_registration_open', '0')
       ON DUPLICATE KEY UPDATE setting_value = setting_value`
    );
    await pool.execute(
      `INSERT INTO app_settings (setting_key, setting_value)
       VALUES ('sponsor_form_registration_open', '0')
       ON DUPLICATE KEY UPDATE setting_value = setting_value`
    );
    await pool.execute(
      `INSERT INTO registration_year_settings (school_year, faith_formation_open, sponsor_form_open)
       VALUES (?, 0, 0)
       ON DUPLICATE KEY UPDATE school_year = school_year`,
      ['2025-2026']
    );

    const legacyYearSetting = await pool.query(
      `SELECT setting_value FROM app_settings WHERE setting_key = 'faith_formation_year' LIMIT 1`
    );
    const legacyFaithOpenSetting = await pool.query(
      `SELECT setting_value FROM app_settings WHERE setting_key = 'faith_formation_registration_open' LIMIT 1`
    );
    const legacySponsorOpenSetting = await pool.query(
      `SELECT setting_value FROM app_settings WHERE setting_key = 'sponsor_form_registration_open' LIMIT 1`
    );

    const legacyYear = legacyYearSetting?.[0]?.[0]?.setting_value || '2025-2026';
    const legacyFaithOpen = legacyFaithOpenSetting?.[0]?.[0]?.setting_value === '1' ? 1 : 0;
    const legacySponsorOpen = legacySponsorOpenSetting?.[0]?.[0]?.setting_value === '1' ? 1 : 0;

    await pool.execute(
      `INSERT INTO registration_year_settings (school_year, faith_formation_open, sponsor_form_open)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE school_year = school_year`,
      [legacyYear, legacyFaithOpen, legacySponsorOpen]
    );
    await pool.execute(
      `UPDATE app_settings
       SET setting_value = ?
       WHERE setting_key = 'current_registration_year' AND (setting_value IS NULL OR setting_value = '')`,
      [legacyYear]
    );

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

// Users are soft-deleted (account_status set to 'deleted', row and its
// registrations kept) rather than removed, so every access-control check
// needs to treat that status as "gone". Centralized here so the status
// value only needs to change in one place.
const isDeletedAccount = (user) => user?.account_status === 'deleted';

module.exports = {
  init,
  prepare,
  isDeletedAccount,
};
