// Registry for the Faith Formation email designs (staff notice, newsletter, parent
// direct, discipleship team letter). Each template is a standalone, send-ready HTML
// file — table-based markup with inline styles, the "bulletproof email" format — with
// placeholders written two ways: {{MergeField}} for per-recipient data and
// [Bracketed prose] for one-off copy the sender fills in per send. This module finds
// those placeholders in a template and fills them in with values a sender supplies, for
// the "pick a template, fill the blanks" composer on the Discipleship Team page.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sanitizeHtml = require('sanitize-html');

const TEMPLATE_DIR = path.join(__dirname, 'email-templates');

const TEMPLATES = [
  { id: 'staff-notice', label: 'Staff notice', file: 'staff-notice-email.html' },
  { id: 'parent-newsletter', label: 'Newsletter (parents & staff)', file: 'parent-newsletter-email.html' },
  { id: 'parent-direct', label: 'Parent direct', file: 'parent-direct-email.html' },
  { id: 'discipleship-team', label: 'Discipleship Team letter', file: 'discipleship-team-email.html' },
];

// {{MergeField}} or [Bracketed placeholder text] — whichever style a given template uses.
const PLACEHOLDER_RE = /\{\{\s*([^{}]+?)\s*\}\}|\[([^[\]]+)\]/g;

// A stable, filesystem/order-independent id for a placeholder, so a form field submitted
// for "field_<id>" always maps back to the same token even if the template file changes
// between rendering the form and handling its submission.
const tokenId = (token) => crypto.createHash('md5').update(token).digest('hex').slice(0, 10);

// HTML comments (notably the `<!--[if mso]>...<![endif]-->` conditional wrappers every
// template uses for Outlook) contain their own bracketed text that must never be offered
// as a fill-in-the-blank field, so placeholder scanning ignores comment contents.
const stripComments = (html) => html.replace(/<!--[\s\S]*?-->/g, (comment) => ' '.repeat(comment.length));

const extractPlaceholders = (html) => {
  const seen = new Map();
  const searchable = stripComments(html);
  let match;
  PLACEHOLDER_RE.lastIndex = 0;
  while ((match = PLACEHOLDER_RE.exec(searchable))) {
    const token = match[0];
    if (seen.has(token)) continue;
    const isMerge = match[1] !== undefined;
    seen.set(token, {
      token,
      id: tokenId(token),
      label: (isMerge ? match[1] : match[2]).trim(),
      kind: isMerge ? 'merge' : 'text',
    });
  }
  return Array.from(seen.values());
};

const getTemplate = (id) => TEMPLATES.find((tpl) => tpl.id === id);

const templateHtmlCache = new Map();
const loadTemplateHtml = (id) => {
  const tpl = getTemplate(id);
  if (!tpl) return null;
  if (!templateHtmlCache.has(id)) {
    templateHtmlCache.set(id, fs.readFileSync(path.join(TEMPLATE_DIR, tpl.file), 'utf8'));
  }
  return templateHtmlCache.get(id);
};

const listTemplatesWithFields = () => TEMPLATES.map((tpl) => ({
  ...tpl,
  fields: extractPlaceholders(loadTemplateHtml(tpl.id)),
}));

const escapeHtml = (value) => String(value == null ? '' : value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

// The staff notice always carries today's date — a sender never backdates or schedules
// one — so the template marks the spot with an HTML comment (`<!--NOTICE_DATE-->`, never
// offered as a fill-in field) instead of a bracket placeholder, and this always computes
// it fresh rather than trusting anything submitted by the sender.
const formatNoticeDate = (date = new Date()) => {
  const weekday = date.toLocaleDateString('en-US', { weekday: 'long' });
  const monthDay = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  return `${weekday}, ${monthDay}`;
};

// Builds the "What we need from you" section for the staff notice from a list of
// {date, text} action items, or '' to drop the section entirely — the block only makes
// sense once there is at least one item to show. Mirrors the row markup the template
// used to hard-code, but the last row alone gets the heavier closing rule that used to
// be pinned to a fixed third "Ongoing" row.
const buildActionItemsSectionHtml = (items) => {
  if (!items || !items.length) return '';
  const rows = items.map((item, index) => {
    const isLast = index === items.length - 1;
    const border = isLast ? 'border-bottom:2px solid #201e1d;' : 'border-bottom:1px solid #d6d4d3;';
    const dateLabel = item.date && String(item.date).trim() ? `By ${escapeHtml(item.date)}` : 'Ongoing';
    const text = escapeHtml(item.text);
    return `
        <tr>
          <td width="120" style="padding:14px 16px 14px 0;${border}font-size:13px;line-height:20px;mso-line-height-rule:exactly;font-weight:700;color:#6b6866;vertical-align:top;">${dateLabel}</td>
          <td style="padding:14px 0;${border}font-size:15px;line-height:22px;mso-line-height-rule:exactly;color:#201e1d;vertical-align:top;">${text}</td>
        </tr>`;
  }).join('');

  return `
  <tr>
    <td class="px" style="padding:8px 40px 0 40px;font-family:Arial,Helvetica,sans-serif;">
      <div style="font-size:11px;line-height:16px;mso-line-height-rule:exactly;font-weight:700;color:#ec3013;letter-spacing:0.14em;text-transform:uppercase;padding-bottom:12px;">What we need from you</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-top:2px solid #201e1d;">${rows}
      </table>
    </td>
  </tr>`;
};

// The read-time subtitle (e.g. "2 min read") is genuinely optional prose, unlike the
// always-present date next to it — so instead of the generic bracket-placeholder
// mechanism (which leaves the literal "[2 min read]" text in place when unfilled), a
// blank value drops both the text and its leading separator dot rather than showing
// either.
const buildReadTimeHtml = (readTime) => (
  readTime && String(readTime).trim() ? ` &middot; ${escapeHtml(readTime)}` : ''
);

// Each paragraph row is a lightweight contenteditable toolbar (bold/italic/underline/
// link/bulleted list only, not a full rich-text library), but contenteditable markup
// still isn't trustworthy just because it came from an admin's browser — a paste or
// direct DOM edit could carry arbitrary tags — and this is about to go out to every
// recipient's inbox, so it's run through an allowlist before use rather than trusted
// or escaped-as-plain-text like the other fields.
const PARAGRAPH_ALLOWED_TAGS = ['b', 'strong', 'i', 'em', 'u', 'br', 'ul', 'ol', 'li', 'a'];
const sanitizeParagraphHtml = (html) => sanitizeHtml(html || '', {
  allowedTags: PARAGRAPH_ALLOWED_TAGS,
  allowedAttributes: { a: ['href', 'target', 'rel'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer' }, true),
  },
});

// The notice body is a sender-chosen number of paragraphs (the composer lets them add
// or remove rows freely, numbered "Paragraph 1", "Paragraph 2", ... with no per-row
// prompt text), so it's a repeated block like the action items rather than a fixed
// bracket placeholder. A blank row — including one that sanitizes down to nothing — is
// dropped, same as a blank action item.
const buildNoticeParagraphsHtml = (paragraphs) => (paragraphs || [])
  .map((html) => sanitizeParagraphHtml(html).trim())
  .filter(Boolean)
  .map((html) => `<p style="margin:0 0 22px 0;font-size:16px;line-height:26px;mso-line-height-rule:exactly;">${html}</p>`)
  .join('\n');

// Per-template hooks applied after the generic bracket/merge-field substitution, for
// spots that aren't sender-typed prose: a computed value (today's date), an optional
// subtitle (read time), or a variable-length repeated block (paragraphs, action items)
// that the {token: value} substitution model above can't express. Each hook receives
// the substituted HTML and the render options passed to renderTemplate, and returns
// HTML with its own markers resolved.
const TEMPLATE_POSTPROCESS = {
  'staff-notice': (html, options) => html
    .replace('<!--NOTICE_DATE-->', escapeHtml(formatNoticeDate()))
    .replace('<!--READ_TIME-->', buildReadTimeHtml(options && options.readTime))
    .replace('<!--NOTICE_PARAGRAPHS-->', buildNoticeParagraphsHtml((options && options.paragraphs) || []))
    .replace('<!--ACTION_ITEMS_SECTION-->', buildActionItemsSectionHtml((options && options.actionItems) || [])),
};

// valuesByToken: { [placeholderToken]: rawSenderText }. A blank or missing value keeps
// the placeholder's own bracket text in place, so an unfilled spot still reads as an
// obvious placeholder rather than turning into empty, broken-looking markup. `options` is
// passed through to the template's postprocess hook, if it has one (see
// TEMPLATE_POSTPROCESS above).
const renderTemplate = (id, valuesByToken, options) => {
  const html = loadTemplateHtml(id);
  if (html == null) return null;
  const fields = extractPlaceholders(html);
  let out = html;
  fields.forEach((field) => {
    const raw = valuesByToken && valuesByToken[field.token];
    const filled = raw && String(raw).trim() ? escapeHtml(raw).replace(/\n/g, '<br>') : field.token;
    out = out.split(field.token).join(filled);
  });
  const postprocess = TEMPLATE_POSTPROCESS[id];
  if (postprocess) out = postprocess(out, options);
  return out;
};

module.exports = {
  TEMPLATES, getTemplate, loadTemplateHtml, listTemplatesWithFields, extractPlaceholders, renderTemplate,
};
