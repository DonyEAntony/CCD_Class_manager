require('dotenv').config({ quiet: true });
if (process.env.DB_NAME !== 'u733721250_faithformtest') throw Error('Test server requires the designated test database');
Object.assign(process.env, {
  PORT: '3198', HOST: '127.0.0.1', APP_BASE_URL: 'http://127.0.0.1:3198',
  COMMUNICATION_WORKER_ENABLED: 'false', SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '', EMAIL_FROM: '',
  GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', GITHUB_CLIENT_ID: '', GITHUB_CLIENT_SECRET: '',
  SESSION_SECRET: require('crypto').randomBytes(32).toString('hex'),
});
require('../app');

