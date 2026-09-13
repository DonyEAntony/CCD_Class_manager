const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeEmailHtml } = require('../email-templates');

test('sanitizeEmailHtml keeps bulletproof-email table markup intact', () => {
  const html = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:10px;background:#1d3131;color:#f2c36b;">Hello</td></tr></table>';
  const out = sanitizeEmailHtml(html);
  assert.match(out, /<table role="presentation" width="100%" cellpadding="0" cellspacing="0">/);
  assert.match(out, /<td style="padding:10px;background:#1d3131;color:#f2c36b;?">Hello<\/td>/);
});

test('sanitizeEmailHtml strips script tags and their content entirely', () => {
  const html = '<table><tr><td>Safe<script>alert(document.cookie)</script></td></tr></table>';
  const out = sanitizeEmailHtml(html);
  assert.ok(!out.includes('<script'));
  assert.ok(!out.includes('alert('));
  assert.ok(out.includes('Safe'));
});

test('sanitizeEmailHtml strips inline event handler attributes', () => {
  const html = '<td onerror="alert(1)" onclick="alert(2)" style="color:red">x</td>';
  const out = sanitizeEmailHtml(html);
  assert.ok(!out.includes('onerror'));
  assert.ok(!out.includes('onclick'));
  assert.ok(out.includes('style="color:red"'));
});

test('sanitizeEmailHtml drops javascript: and data: link/image schemes', () => {
  const html = '<a href="javascript:alert(1)">click</a><img src="data:text/html,evil">';
  const out = sanitizeEmailHtml(html);
  assert.ok(!out.includes('javascript:'));
  assert.ok(!out.includes('src="data:'));
});

test('sanitizeEmailHtml keeps http(s), mailto links and https images', () => {
  const html = '<a href="https://example.org">site</a> <a href="mailto:office@example.org">email</a> <img src="https://example.org/logo.png" alt="logo">';
  const out = sanitizeEmailHtml(html);
  assert.ok(out.includes('href="https://example.org"'));
  assert.ok(out.includes('href="mailto:office@example.org"'));
  assert.ok(out.includes('src="https://example.org/logo.png"'));
});

test('sanitizeEmailHtml forces target=_blank and safe rel on links', () => {
  const out = sanitizeEmailHtml('<a href="https://example.org">site</a>');
  assert.match(out, /target="_blank"/);
  assert.match(out, /rel="noopener noreferrer"/);
});

test('sanitizeEmailHtml unwraps disallowed wrapper tags but keeps their safe children', () => {
  const html = '<html><head><style>body{color:red}</style></head><body><table><tr><td>content</td></tr></table></body></html>';
  const out = sanitizeEmailHtml(html);
  assert.ok(!out.includes('<html'));
  assert.ok(!out.includes('<style'));
  assert.ok(!out.includes('color:red'));
  assert.ok(out.includes('<table>'));
  assert.ok(out.includes('content'));
});
