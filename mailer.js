const nodemailer = require('nodemailer');

const hasSmtpConfig = Boolean(process.env.SMTP_HOST && process.env.EMAIL_FROM);
const resolvedFrom = (() => {
  const from = (process.env.EMAIL_FROM || '').trim();
  const smtpUser = (process.env.SMTP_USER || '').trim();
  if (!from) return '';
  if (from.includes('@') || !smtpUser) return from;
  return `${from} <${smtpUser}>`;
})();

const smtpLogConfig = {
  host: process.env.SMTP_HOST || '',
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === 'true',
  hasUser: Boolean(process.env.SMTP_USER),
  hasPass: Boolean(process.env.SMTP_PASS),
  from: resolvedFrom,
};

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
    console.warn('[mail] Verification email skipped: SMTP config incomplete', {
      host: smtpLogConfig.host,
      port: smtpLogConfig.port,
      secure: smtpLogConfig.secure,
      hasUser: smtpLogConfig.hasUser,
      hasPass: smtpLogConfig.hasPass,
      from: smtpLogConfig.from,
    });
    return { delivered: false };
  }

  console.info('[mail] Sending verification email', {
    to,
    host: smtpLogConfig.host,
    port: smtpLogConfig.port,
    secure: smtpLogConfig.secure,
    from: smtpLogConfig.from,
  });

  const info = await transporter.sendMail({
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

  console.info('[mail] Verification email accepted by SMTP server', {
    to,
    messageId: info.messageId,
    response: info.response,
    previewPath: verificationUrl ? '/verify-email?token=[redacted]' : null,
  });

  return { delivered: true, messageId: info.messageId, response: info.response };
};

module.exports = { hasSmtpConfig, sendVerificationEmail, resolvedFrom, smtpLogConfig };
