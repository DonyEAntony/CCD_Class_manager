module.exports = async function paymentSchema(pool) {
  const connection = await pool.getConnection();
  let locked = false;
  try {
    const [[lock]] = await connection.query("SELECT GET_LOCK(SHA2(CONCAT(DATABASE(), ':payment-ledger-migration'), 256), 30) AS acquired");
    if (Number(lock.acquired) !== 1) throw new Error('Payment migration is already running; retry startup after it finishes');
    locked = true;
  await connection.query(`CREATE TABLE IF NOT EXISTS tuition_payments (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    entry_key VARCHAR(100) NOT NULL UNIQUE,
    amount DECIMAL(12,2) NULL,
    paid_at DATETIME NULL,
    method VARCHAR(30) NULL,
    transaction_id VARCHAR(255) NULL,
    recorded_by INT NULL,
    legacy_entry TINYINT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX payment_transaction (transaction_id)
  )`);
  await connection.query(`CREATE TABLE IF NOT EXISTS tuition_payment_links (
    payment_id INT NOT NULL,
    target_key VARCHAR(60) NOT NULL,
    registration_id INT NULL,
    student_id INT NULL,
    PRIMARY KEY (payment_id, target_key),
    INDEX payment_registration (registration_id), INDEX payment_student (student_id)
  )`);
  await connection.query(`CREATE TABLE IF NOT EXISTS tuition_payment_voids (
    payment_id INT NOT NULL PRIMARY KEY,
    reason VARCHAR(500) NOT NULL,
    recorded_by INT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await connection.query(`CREATE TABLE IF NOT EXISTS tuition_payment_exceptions (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    entry_key VARCHAR(100) NOT NULL UNIQUE,
    school_year VARCHAR(20) NOT NULL,
    payload LONGTEXT NOT NULL,
    category VARCHAR(30) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME NULL,
    resolved_by INT NULL,
    resolution_note VARCHAR(1000) NULL
  )`);
  await connection.query(`CREATE TABLE IF NOT EXISTS tuition_payment_corrections (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    payment_id INT NOT NULL,
    old_amount DECIMAL(12,2) NULL,
    new_amount DECIMAL(12,2) NOT NULL,
    reason VARCHAR(500) NOT NULL,
    recorded_by INT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX correction_payment (payment_id)
  )`);
  // Mark the one-time snapshot migration separately: later snapshot updates must
  // never be re-imported as extra historical payments on application restart.
  const [done] = await connection.query("SELECT setting_value FROM app_settings WHERE setting_key = 'payment_ledger_migrated'");
  if (done.length) return;
  await connection.query('ALTER TABLE student_registrations MODIFY tuition_amount_paid DECIMAL(12,2) NULL');
  await connection.query('ALTER TABLE students MODIFY tuition_amount_paid DECIMAL(12,2) NULL');
    await connection.beginTransaction();
    const key = "CASE WHEN NULLIF(tuition_transaction_id, '') IS NOT NULL THEN CONCAT('import:', SHA2(tuition_transaction_id, 256)) ELSE CONCAT('legacy:registration:', id) END";
    await connection.query(`INSERT IGNORE INTO tuition_payments (entry_key, amount, paid_at, method, transaction_id, recorded_by, legacy_entry)
      SELECT ${key}, tuition_amount_paid, tuition_paid_at, tuition_payment_method, tuition_transaction_id, tuition_paid_by, 1
      FROM student_registrations WHERE tuition_paid = 1 ORDER BY id`);
    await connection.query(`INSERT IGNORE INTO tuition_payment_links (payment_id, target_key, registration_id, student_id)
      SELECT p.id, CONCAT('registration:', r.id), r.id, r.student_id FROM student_registrations r
      JOIN tuition_payments p ON p.entry_key = CASE WHEN NULLIF(r.tuition_transaction_id, '') IS NOT NULL THEN CONCAT('import:', SHA2(r.tuition_transaction_id, 256)) ELSE CONCAT('legacy:registration:', r.id) END
      WHERE r.tuition_paid = 1`);
    await connection.query(`INSERT IGNORE INTO tuition_payments (entry_key, amount, paid_at, method, transaction_id, recorded_by, legacy_entry)
      SELECT CASE WHEN NULLIF(s.tuition_transaction_id, '') IS NOT NULL THEN CONCAT('import:', SHA2(s.tuition_transaction_id, 256)) ELSE CONCAT('legacy:student:', s.id) END,
      s.tuition_amount_paid, s.tuition_paid_at, s.tuition_payment_method, s.tuition_transaction_id, s.tuition_paid_by, 1
      FROM students s WHERE s.tuition_paid = 1 AND NOT EXISTS (SELECT 1 FROM tuition_payment_links l WHERE l.student_id = s.id OR l.registration_id = s.source_registration_id)`);
    await connection.query(`INSERT IGNORE INTO tuition_payment_links (payment_id, target_key, registration_id, student_id)
      SELECT p.id, CONCAT('student:', s.id), s.source_registration_id, s.id FROM students s
      JOIN tuition_payments p ON p.entry_key = CASE WHEN NULLIF(s.tuition_transaction_id, '') IS NOT NULL THEN CONCAT('import:', SHA2(s.tuition_transaction_id, 256)) ELSE CONCAT('legacy:student:', s.id) END
      WHERE s.tuition_paid = 1 AND NOT EXISTS (SELECT 1 FROM tuition_payment_links l WHERE l.student_id = s.id OR l.registration_id = s.source_registration_id)`);
    // Conflicting copies of a shared import require review; do not guess which
    // amount is correct. The original per-registration values remain intact.
    await connection.query(`UPDATE tuition_payments p JOIN
      (SELECT tuition_transaction_id AS transaction_id FROM student_registrations
       WHERE tuition_paid = 1 AND NULLIF(tuition_transaction_id, '') IS NOT NULL
       GROUP BY tuition_transaction_id HAVING COUNT(DISTINCT tuition_amount_paid) > 1 OR COUNT(tuition_amount_paid) < COUNT(*)) inconsistent
      ON inconsistent.transaction_id = p.transaction_id SET p.amount = NULL WHERE p.legacy_entry = 1`);
    await connection.query("INSERT IGNORE INTO app_settings (setting_key, setting_value) VALUES ('payment_ledger_migrated', '1')");
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; }
  finally {
    try {
      if (locked) await connection.query("SELECT RELEASE_LOCK(SHA2(CONCAT(DATABASE(), ':payment-ledger-migration'), 256))");
    } finally { connection.release(); }
  }
};
