// Additive migrations, run by db.init() after users/classes have been initialized.
module.exports = async (pool) => {
  await pool.query(`CREATE TABLE IF NOT EXISTS class_reminder_settings (
    class_id INT NOT NULL PRIMARY KEY,
    enabled TINYINT NOT NULL DEFAULT 0,
    days_before INT NOT NULL DEFAULT 1,
    send_hour INT NOT NULL DEFAULT 18,
    FOREIGN KEY (class_id) REFERENCES ccd_classes(id) ON DELETE CASCADE
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS communication_preferences (
    user_id INT NOT NULL PRIMARY KEY,
    class_reminders TINYINT NOT NULL DEFAULT 1,
    message_emails TINYINT NOT NULL DEFAULT 1,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS family_conversations (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    class_id INT NOT NULL,
    parent_id INT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_family_class (class_id, parent_id),
    FOREIGN KEY (class_id) REFERENCES ccd_classes(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS family_messages (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    conversation_id INT NOT NULL,
    sender_id INT NOT NULL,
    body TEXT NOT NULL,
    submission_key VARCHAR(36) NOT NULL UNIQUE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_conversation_messages (conversation_id, id),
    FOREIGN KEY (conversation_id) REFERENCES family_conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (sender_id) REFERENCES users(id)
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS family_message_reads (
    conversation_id INT NOT NULL,
    user_id INT NOT NULL,
    last_message_id INT NOT NULL DEFAULT 0,
    PRIMARY KEY (conversation_id, user_id),
    FOREIGN KEY (conversation_id) REFERENCES family_conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS communication_outbox (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    dedupe_key VARCHAR(190) NOT NULL UNIQUE,
    kind VARCHAR(20) NOT NULL,
    user_id INT NOT NULL,
    class_id INT NOT NULL,
    conversation_id INT NULL,
    session_date DATE NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    attempts INT NOT NULL DEFAULT 0,
    next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    claim_token VARCHAR(36) NULL,
    locked_until DATETIME NULL,
    last_error VARCHAR(255) NULL,
    sent_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_outbox_due (status, next_attempt_at),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (class_id) REFERENCES ccd_classes(id) ON DELETE CASCADE,
    FOREIGN KEY (conversation_id) REFERENCES family_conversations(id) ON DELETE CASCADE
  )`);
};
