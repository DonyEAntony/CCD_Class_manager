const nodemailer = require('nodemailer');

const hasSmtpConfig = Boolean(process.env.SMTP_HOST && process.env.EMAIL_FROM);
const resolvedFrom = (() => {
  const from = (process.env.EMAIL_FROM || '').trim();
  const smtpUser = (process.env.SMTP_USER || '').trim();
  if (!from) return '';
  if (from.includes('@') || !smtpUser) return from;
  return `${from} <${smtpUser}>`;
})();

const createTransporter = () => {
  if (!hasSmtpConfig) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER
      ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        }
      : undefined,
  });
};

const sendVerificationEmail = async ({ to, verificationUrl, fullName }) => {
  const transporter = createTransporter();
  if (!transporter) {
    return { delivered: false };
  }

  await transporter.sendMail({
    from: resolvedFrom,
    to,
    subject: 'Verify your Saint Matthew CCD account',
    text: [
      `Hello ${fullName || ''}`.trim() + ',',
      '',
      'Please verify your email address before logging in.',
      verificationUrl,
      '',
      'If you did not create this account, you can ignore this message.',
    ].join('\n'),
    html: `
      <p>Hello ${fullName || ''},</p>
      <p>Please verify your email address before logging in.</p>
      <p><a href="${verificationUrl}">Verify your account</a></p>
      <p>If you did not create this account, you can ignore this message.</p>
    `,
  });

  return { delivered: true };
};

module.exports = { hasSmtpConfig, sendVerificationEmail, resolvedFrom };
