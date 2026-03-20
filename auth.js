const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const GitHubStrategy = require('passport-github2').Strategy;
const bcrypt = require('bcryptjs');
const db = require('./db');

passport.use(
  new LocalStrategy({ usernameField: 'email' }, async (email, password, done) => {
    try {
      const user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
      if (!user || !user.password_hash) {
        return done(null, false, { message: 'Invalid email or password.' });
      }
      if (!user.is_active) {
        return done(null, false, { message: 'Please verify your email before logging in.' });
      }
      const matches = bcrypt.compareSync(password, user.password_hash);
      if (!matches) {
        return done(null, false, { message: 'Invalid email or password.' });
      }
      return done(null, user);
    } catch (error) {
      return done(error);
    }
  }),
);

const upsertOAuthUser = async (provider, profile, done) => {
  try {
    const providerId = profile.id;
    const email = profile.emails?.[0]?.value?.toLowerCase();
    if (!email) {
      return done(null, false, { message: 'No email available from provider.' });
    }

    const existing = await db
      .prepare('SELECT * FROM users WHERE provider = ? AND provider_id = ?')
      .get(provider, providerId);
    if (existing) return done(null, existing);

    const linkedByEmail = await db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (linkedByEmail) {
      await db.prepare(`
        UPDATE users
        SET provider = ?, provider_id = ?, is_active = 1,
            email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP),
            email_verification_token = NULL, email_verification_expires_at = NULL
        WHERE id = ?
      `).run(provider, providerId, linkedByEmail.id);
      const updated = await db.prepare('SELECT * FROM users WHERE id = ?').get(linkedByEmail.id);
      return done(null, updated);
    }

    const role = email === process.env.ADMIN_EMAIL?.toLowerCase() ? 'admin' : 'user';
    const fullName = profile.displayName || '';
    const result = await db
      .prepare(`
        INSERT INTO users (email, role, provider, provider_id, full_name, is_active, email_verified_at)
        VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
      `)
      .run(email, role, provider, providerId, fullName);

    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    return done(null, user);
  } catch (error) {
    return done(error);
  }
};

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: '/auth/google/callback',
      },
      (accessToken, refreshToken, profile, done) => upsertOAuthUser('google', profile, done),
    ),
  );
}

if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
  passport.use(
    new GitHubStrategy(
      {
        clientID: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET,
        callbackURL: '/auth/github/callback',
        scope: ['user:email'],
      },
      (accessToken, refreshToken, profile, done) => upsertOAuthUser('github', profile, done),
    ),
  );
}

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    done(null, user || false);
  } catch (error) {
    done(error);
  }
});

module.exports = passport;
