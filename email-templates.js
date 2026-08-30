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

// valuesByToken: { [placeholderToken]: rawSenderText }. A blank or missing value keeps
// the placeholder's own bracket text in place, so an unfilled spot still reads as an
// obvious placeholder rather than turning into empty, broken-looking markup.
const renderTemplate = (id, valuesByToken) => {
  const html = loadTemplateHtml(id);
  if (html == null) return null;
  const fields = extractPlaceholders(html);
  let out = html;
  fields.forEach((field) => {
    const raw = valuesByToken && valuesByToken[field.token];
    const filled = raw && String(raw).trim() ? escapeHtml(raw).replace(/\n/g, '<br>') : field.token;
    out = out.split(field.token).join(filled);
  });
  return out;
};

module.exports = {
  TEMPLATES, getTemplate, loadTemplateHtml, listTemplatesWithFields, extractPlaceholders, renderTemplate,
};
