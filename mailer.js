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

const verifyMailConfiguration = async () => {
  const transporter = createTransporter();
  if (!transporter) {
    return {
      ok: false,
      reason: 'SMTP config incomplete',
      config: smtpLogConfig,
    };
  }

  await transporter.verify();
  return {
    ok: true,
    config: smtpLogConfig,
  };
};

const buildVerificationEmailContent = ({ verificationUrl, fullName }) => ({
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

  const content = buildVerificationEmailContent({ verificationUrl, fullName });
  const info = await transporter.sendMail({
    from: resolvedFrom,
    to,
    subject: content.subject,
    text: content.text,
    html: content.html,
  });

  console.info('[mail] Verification email accepted by SMTP server', {
    to,
    messageId: info.messageId,
    response: info.response,
    previewPath: verificationUrl ? '/verify-email?token=[redacted]' : null,
  });

  return { delivered: true, messageId: info.messageId, response: info.response };
};

const escapeHtml = (value) => String(value == null ? '' : value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const buildClassMessageEmailContent = ({ subject, message, senderName }) => ({
  subject: subject && subject.trim() ? subject.trim() : 'Message from Saint Matthew Faith Formation',
  text: senderName ? `${message}\n\n— ${senderName}` : message,
  html: `
    <p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>
    ${senderName ? `<p>&mdash; ${escapeHtml(senderName)}</p>` : ''}
  `,
});

// The system EMAIL_FROM is a bare mailbox address shared by every automated email
// (verification, password reset, etc). Class messages are personal correspondence
// from a specific catechist/admin, so they get that sender's name in the From
// display name and their own address as Reply-To — replies go straight to the
// person who actually sent the message, not a noreply inbox.
const extractEmailAddress = (fromValue) => {
  const match = /<([^>]+)>/.exec(fromValue || '');
  return match ? match[1] : (fromValue || '');
};

const sendClassMessageEmail = async ({ to, subject, message, senderName, cc, bcc, replyTo, attachments }) => {
  const transporter = createTransporter();
  if (!transporter) {
    console.warn('[mail] Class message email skipped: SMTP config incomplete', {
      host: smtpLogConfig.host,
      port: smtpLogConfig.port,
      secure: smtpLogConfig.secure,
      hasUser: smtpLogConfig.hasUser,
      hasPass: smtpLogConfig.hasPass,
      from: smtpLogConfig.from,
    });
    return { delivered: false };
  }

  console.info('[mail] Sending class message email', {
    to,
    cc: cc || undefined,
    bcc: bcc || undefined,
    replyTo: replyTo || undefined,
    attachmentCount: attachments ? attachments.length : 0,
    host: smtpLogConfig.host,
    port: smtpLogConfig.port,
    secure: smtpLogConfig.secure,
    from: smtpLogConfig.from,
  });

  const content = buildClassMessageEmailContent({ subject, message, senderName });
  const from = senderName ? { name: senderName, address: extractEmailAddress(resolvedFrom) } : resolvedFrom;
  const info = await transporter.sendMail({
    from,
    to,
    cc: cc || undefined,
    bcc: bcc || undefined,
    replyTo: replyTo || undefined,
    subject: content.subject,
    text: content.text,
    html: content.html,
    attachments: attachments && attachments.length ? attachments : undefined,
  });

  console.info('[mail] Class message email accepted by SMTP server', {
    to,
    messageId: info.messageId,
    response: info.response,
  });

  return { delivered: true, messageId: info.messageId, response: info.response };
};

const buildPasswordResetEmailContent = ({ resetUrl, fullName }) => ({
  subject: 'Reset your Saint Matthew CCD password',
  text: [
    `Hello ${fullName || ''}`.trim() + ',',
    '',
    'We received a request to reset your password. This link expires in 1 hour.',
    resetUrl,
    '',
    'If you did not request this, you can ignore this message and your password will stay the same.',
  ].join('\n'),
  html: `
    <p>Hello ${fullName || ''},</p>
    <p>We received a request to reset your password. This link expires in 1 hour.</p>
    <p><a href="${resetUrl}">Reset your password</a></p>
    <p>If you did not request this, you can ignore this message and your password will stay the same.</p>
  `,
});

const sendPasswordResetEmail = async ({ to, resetUrl, fullName }) => {
  const transporter = createTransporter();
  if (!transporter) {
    console.warn('[mail] Password reset email skipped: SMTP config incomplete', {
      host: smtpLogConfig.host,
      port: smtpLogConfig.port,
      secure: smtpLogConfig.secure,
      hasUser: smtpLogConfig.hasUser,
      hasPass: smtpLogConfig.hasPass,
      from: smtpLogConfig.from,
    });
    return { delivered: false };
  }

  console.info('[mail] Sending password reset email', {
    to,
    host: smtpLogConfig.host,
    port: smtpLogConfig.port,
    secure: smtpLogConfig.secure,
    from: smtpLogConfig.from,
  });

  const content = buildPasswordResetEmailContent({ resetUrl, fullName });
  const info = await transporter.sendMail({
    from: resolvedFrom,
    to,
    subject: content.subject,
    text: content.text,
    html: content.html,
  });

  console.info('[mail] Password reset email accepted by SMTP server', {
    to,
    messageId: info.messageId,
    response: info.response,
    previewPath: resetUrl ? '/reset-password?token=[redacted]' : null,
  });

  return { delivered: true, messageId: info.messageId, response: info.response };
};

const buildCatechistInvitationEmailContent = ({ activationUrl, fullName }) => ({
  subject: 'You are invited as a Catechist — Saint Matthew CCD',
  text: [
    `Hello ${fullName || ''}`.trim() + ',',
    '',
    'An administrator has created a Catechist account for you at Saint Matthew Faith Formation.',
    'Set your password to activate your account. This link expires in 7 days.',
    activationUrl,
    '',
    'If you were not expecting this invitation, you can ignore this message.',
  ].join('\n'),
  html: `
    <p>Hello ${fullName || ''},</p>
    <p>An administrator has created a Catechist account for you at Saint Matthew Faith Formation.</p>
    <p>Set your password to activate your account. This link expires in 7 days.</p>
    <p><a href="${activationUrl}">Activate your account</a></p>
    <p>If you were not expecting this invitation, you can ignore this message.</p>
  `,
});

const buildTemporaryPasswordEmailContent = ({ tempPassword, loginUrl, fullName }) => ({
  subject: 'Your Saint Matthew CCD account has been created',
  text: [
    `Hello ${fullName || ''}`.trim() + ',',
    '',
    'An administrator has created an account for you at Saint Matthew Faith Formation.',
    `Temporary password: ${tempPassword}`,
    '',
    `Log in here: ${loginUrl}`,
    'You will be asked to set a new password the first time you log in.',
    '',
    'If you were not expecting this account, you can ignore this message.',
  ].join('\n'),
  html: `
    <p>Hello ${fullName || ''},</p>
    <p>An administrator has created an account for you at Saint Matthew Faith Formation.</p>
    <p>Temporary password: <strong>${tempPassword}</strong></p>
    <p><a href="${loginUrl}">Log in</a></p>
    <p>You will be asked to set a new password the first time you log in.</p>
    <p>If you were not expecting this account, you can ignore this message.</p>
  `,
});

const sendTemporaryPasswordEmail = async ({ to, tempPassword, loginUrl, fullName }) => {
  const transporter = createTransporter();
  if (!transporter) {
    console.warn('[mail] Temporary password email skipped: SMTP config incomplete', {
      host: smtpLogConfig.host,
      port: smtpLogConfig.port,
      secure: smtpLogConfig.secure,
      hasUser: smtpLogConfig.hasUser,
      hasPass: smtpLogConfig.hasPass,
      from: smtpLogConfig.from,
    });
    return { delivered: false };
  }

  console.info('[mail] Sending temporary password email', {
    to,
    host: smtpLogConfig.host,
    port: smtpLogConfig.port,
    secure: smtpLogConfig.secure,
    from: smtpLogConfig.from,
  });

  const content = buildTemporaryPasswordEmailContent({ tempPassword, loginUrl, fullName });
  const info = await transporter.sendMail({
    from: resolvedFrom,
    to,
    subject: content.subject,
    text: content.text,
    html: content.html,
  });

  console.info('[mail] Temporary password email accepted by SMTP server', {
    to,
    messageId: info.messageId,
    response: info.response,
  });

  return { delivered: true, messageId: info.messageId, response: info.response };
};

const sendCatechistInvitationEmail = async ({ to, activationUrl, fullName }) => {
  const transporter = createTransporter();
  if (!transporter) {
    console.warn('[mail] Catechist invitation email skipped: SMTP config incomplete', {
      host: smtpLogConfig.host,
      port: smtpLogConfig.port,
      secure: smtpLogConfig.secure,
      hasUser: smtpLogConfig.hasUser,
      hasPass: smtpLogConfig.hasPass,
      from: smtpLogConfig.from,
    });
    return { delivered: false };
  }

  console.info('[mail] Sending catechist invitation email', {
    to,
    host: smtpLogConfig.host,
    port: smtpLogConfig.port,
    secure: smtpLogConfig.secure,
    from: smtpLogConfig.from,
  });

  const content = buildCatechistInvitationEmailContent({ activationUrl, fullName });
  const info = await transporter.sendMail({
    from: resolvedFrom,
    to,
    subject: content.subject,
    text: content.text,
    html: content.html,
  });

  console.info('[mail] Catechist invitation email accepted by SMTP server', {
    to,
    messageId: info.messageId,
    response: info.response,
    previewPath: activationUrl ? '/reset-password?token=[redacted]' : null,
  });

  return { delivered: true, messageId: info.messageId, response: info.response };
};

module.exports = {
  hasSmtpConfig, sendVerificationEmail, resolvedFrom, smtpLogConfig, verifyMailConfiguration, buildVerificationEmailContent,
  sendPasswordResetEmail, buildPasswordResetEmailContent, sendClassMessageEmail, buildClassMessageEmailContent,
  sendCatechistInvitationEmail, buildCatechistInvitationEmailContent,
  sendTemporaryPasswordEmail, buildTemporaryPasswordEmailContent,
};
