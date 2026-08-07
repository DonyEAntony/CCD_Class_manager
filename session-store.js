const session = require('express-session');
const db = require('./db');

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const getExpiryDate = (sessionData, fallbackMaxAgeMs) => {
  const cookie = sessionData?.cookie || {};

  if (typeof cookie.maxAge === 'number') {
    return new Date(Date.now() + cookie.maxAge);
  }

  if (cookie.expires) {
    const expires = new Date(cookie.expires);
    if (!Number.isNaN(expires.getTime())) {
      return expires;
    }
  }

  return new Date(Date.now() + fallbackMaxAgeMs);
};

class MySqlSessionStore extends session.Store {
  constructor(options = {}) {
    super();
    this.defaultMaxAgeMs = options.defaultMaxAgeMs || Number(process.env.SESSION_MAX_AGE_MS || ONE_DAY_MS);
    this.cleanupIntervalMs = options.cleanupIntervalMs || Number(process.env.SESSION_CLEANUP_INTERVAL_MS || 15 * 60 * 1000);

    if (this.cleanupIntervalMs > 0) {
      this.cleanupInterval = setInterval(() => {
        this.cleanupExpired().catch((error) => this.emit('disconnect', error));
      }, this.cleanupIntervalMs);
      this.cleanupInterval.unref?.();
    }
  }

  get(sid, callback) {
    (async () => {
      const row = await db.prepare(
        'SELECT data FROM sessions WHERE sid = ? AND expires_at > NOW() LIMIT 1'
      ).get(sid);

      if (!row) {
        callback(null, null);
        return;
      }

      callback(null, JSON.parse(row.data));
    })().catch(callback);
  }

  set(sid, sessionData, callback = () => {}) {
    (async () => {
      const expiresAt = getExpiryDate(sessionData, this.defaultMaxAgeMs);
      await db.prepare(
        `INSERT INTO sessions (sid, data, expires_at)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE data = VALUES(data), expires_at = VALUES(expires_at)`
      ).run(sid, JSON.stringify(sessionData), expiresAt);
      callback(null);
    })().catch(callback);
  }

  touch(sid, sessionData, callback = () => {}) {
    (async () => {
      const expiresAt = getExpiryDate(sessionData, this.defaultMaxAgeMs);
      await db.prepare('UPDATE sessions SET expires_at = ? WHERE sid = ?').run(expiresAt, sid);
      callback(null);
    })().catch(callback);
  }

  destroy(sid, callback = () => {}) {
    (async () => {
      await db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      callback(null);
    })().catch(callback);
  }

  cleanupExpired() {
    return db.prepare('DELETE FROM sessions WHERE expires_at <= NOW()').run();
  }

  close() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}

module.exports = MySqlSessionStore;
