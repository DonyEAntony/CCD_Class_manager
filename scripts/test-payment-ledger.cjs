// Isolated integration test. Creates and removes only a uniquely named test database.
require('dotenv').config({ quiet: true });
const mysql = require('mysql2/promise');
const assert = require('node:assert/strict');
const { randomUUID } = require('crypto');
const migrate = require('../payment-schema');
const { appendPayment, registrationPayments } = require('../payment-ledger');
const { getDashboardPayments } = require('../dashboard-payments');
const database = 'codex_payment_test_' + randomUUID().replaceAll('-', '');
const existingDatabase = process.argv.find(arg => arg.startsWith('--existing-empty='))?.split('=')[1];
const config = { host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '', connectTimeout: 8000 };
const adapter = connection => ({ prepare(sql) { return {
  get: async (...args) => (await connection.execute(sql, args))[0][0],
  all: async (...args) => (await connection.execute(sql, args))[0],
  run: async (...args) => { const [result] = await connection.execute(sql, args); return { changes: result.affectedRows, lastInsertRowid: result.insertId }; },
}; } });
(async () => {
  let bootstrap, pool;
  try {
    if (existingDatabase) {
      if (existingDatabase !== process.env.DB_NAME || !/test/i.test(existingDatabase)) throw Error('Explicit test database must match DB_NAME');
      pool = mysql.createPool({ ...config, database: existingDatabase });
      const [tables] = await pool.query('SHOW TABLES');
      if (tables.length) throw Error('Test database must be empty; no tables were changed');
    } else {
      bootstrap = await mysql.createConnection(config);
      await bootstrap.query(`CREATE DATABASE \`${database}\``);
      pool = mysql.createPool({ ...config, database });
    }
    await pool.query('CREATE TABLE app_settings (setting_key VARCHAR(100) PRIMARY KEY, setting_value TEXT)');
    const paymentColumns = 'tuition_paid INT, tuition_amount_paid INT NULL, tuition_paid_at DATETIME NULL, tuition_paid_by INT NULL, tuition_payment_method VARCHAR(30) NULL, tuition_transaction_id VARCHAR(255) NULL';
    await pool.query(`CREATE TABLE student_registrations (id INT PRIMARY KEY, student_id INT, user_id INT, student_full_name VARCHAR(100), status VARCHAR(40), archived_at DATETIME NULL, registration_fee INT, sacramental_fee INT, late_fee INT, ${paymentColumns})`);
    await pool.query(`CREATE TABLE students (id INT PRIMARY KEY, source_registration_id INT, ${paymentColumns})`);
    await pool.query("INSERT INTO student_registrations (id,student_id,user_id,student_full_name,status,registration_fee,tuition_paid,tuition_amount_paid,tuition_transaction_id,tuition_payment_method) VALUES (1,11,1,'One','admitted',200,1,100,'IMPORT-1','imported'),(2,12,1,'Two','admitted',200,1,100,'IMPORT-1','imported'),(3,13,2,'Three','admitted',150,1,NULL,NULL,NULL)");
    await pool.query('INSERT INTO students (id,source_registration_id) VALUES (11,1),(12,2),(13,3)');
    await migrate(pool);
    const db = adapter(pool);
    db.transaction = async fn => { const c = await pool.getConnection(); try { await c.beginTransaction(); const result = await fn(adapter(c)); await c.commit(); return result; } catch(e) { await c.rollback(); throw e; } finally { c.release(); } };
    assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM tuition_payments').get()).n), 2);
    const target = [{ registrationId: 1, studentId: 11 }];
    const entry = { key: 'manual:test', amount: 25.75, date: '2026-09-07', method: 'check', recordedBy: 1 };
    const first = await appendPayment(db, entry, target);
    const retry = await appendPayment(db, entry, target);
    assert.equal(first.id, retry.id); assert.equal(retry.duplicate, true);
    await Promise.all(['second','third'].map(key => appendPayment(db, { ...entry, key, amount: 10.25, method: 'credit_card' }, target)));
    const snapshot = await db.prepare('SELECT tuition_amount_paid FROM student_registrations WHERE id=1').get();
    assert.equal(Number(snapshot.tuition_amount_paid), 146.25);
    assert.equal(Number((await db.prepare('SELECT amount FROM tuition_payments WHERE id=?').get(first.id)).amount), 25.75);
    await migrate(pool);
    assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM tuition_payments').get()).n), 5);
    const regs = await db.prepare('SELECT * FROM student_registrations').all();
    const summary = getDashboardPayments(regs, 1, await registrationPayments(db, 1));
    assert.equal(summary.payments.length, 4); assert.equal(summary.totalRecorded, 146.25);
    assert.equal(summary.payments.filter(p => p.names.length === 2).length, 1);
    assert.equal(getDashboardPayments(regs, 2, await registrationPayments(db, 2)).balance, null);
    // Failure must roll back a newly inserted entry and its first link.
    const faulty = { ...db, transaction: fn => db.transaction(tx => fn({ prepare(sql) {
      if (sql.startsWith('UPDATE students')) throw Error('Injected failure');
      return tx.prepare(sql);
    } })) };
    await assert.rejects(appendPayment(faulty, { ...entry, key: 'rollback' }, target));
    assert.equal(await db.prepare("SELECT id FROM tuition_payments WHERE entry_key='rollback'").get(), undefined);
    console.log('PASS: snapshot migration, shared import, appended check/card installments, cents, retries, immutable receipt amounts, restart idempotency, family totals, unknown amounts, transaction rollback.' + ' Concurrent payments passed.');
  } finally {
    if (pool) await pool.end();
    if (bootstrap) {
      if (!/^codex_payment_test_[a-f0-9]{32}$/.test(database)) throw Error('Unexpected test database name');
      await bootstrap.query(`DROP DATABASE IF EXISTS \`${database}\``);
      await bootstrap.end();
    }
  }
})().catch(error => { console.error(error.code || error.message); process.exitCode = 1; });
