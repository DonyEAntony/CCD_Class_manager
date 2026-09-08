const fs = require('fs');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { expect } = require('@playwright/test');
const fixture = JSON.parse(fs.readFileSync('test-results/dashboard-e2e.json'));
const base = 'http://127.0.0.1:3197';

(async () => {
  const browser = await chromium.launch();
  try {
    async function login(key) {
      const context = await browser.newContext();
      await context.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ path: 'test-results/' + (route.request().url().endsWith('.css') ? 'bootstrap.min.css' : 'bootstrap.bundle.min.js') }));
      await context.route('https://fonts.googleapis.com/**', route => route.abort());
      await context.route('https://fonts.gstatic.com/**', route => route.abort());
      const page = await context.newPage();
      await page.goto(base + '/login', { waitUntil: 'domcontentloaded' });
      await page.locator('[name="email"]').fill(fixture.users[key].email);
      await page.locator('[name="password"]').fill(fixture.password);
      await page.locator('form[action="/login"] button[type="submit"]').click();
      await expect(page).toHaveURL(base + '/dashboard');
      await expect(page.locator('h1')).toBeVisible();
      return { context, page };
    }
    const admin = await login('admin');
    await expect(admin.page.locator('#attention-heading')).toBeVisible();
    async function record(method, amount) {
      await admin.page.goto(base + `/admin/students?status=all#student-detail-${fixture.studentId}`, { waitUntil: 'domcontentloaded' });
      const form = admin.page.locator(`form[action="/admin/students/${fixture.studentId}/payment"]`);
      await expect(form).toBeVisible();
      await form.locator('[name="amount"]').fill(amount);
      await form.locator('[name="method"]').selectOption(method);
      const token = await form.locator('[name="submission_key"]').inputValue();
      const date = await form.locator('[name="payment_date"]').inputValue();
      await form.locator('button[type="submit"]').click();
      await expect(admin.page).toHaveURL(/\/receipt\?payment=\d+$/);
      await expect(admin.page.locator('.receipt-amount')).toHaveText('$' + amount);
      return { url: admin.page.url(), token, date };
    }
    const check = await record('check', '25.50');
    const retry = await admin.context.request.post(base + `/admin/students/${fixture.studentId}/payment`, { form: { amount: '25.50', method: 'check', submission_key: check.token, payment_date: check.date } });
    assert.equal(retry.url(), check.url);
    const parent = await login('parent');
    const payments = parent.page.locator('section').filter({ has: parent.page.locator('#payment-heading') });
    await expect(payments).toContainText('$100.50');
    await expect(payments).toContainText('$49.50');
    assert.equal(await payments.locator('.border-top').count(), 2);
    await record('credit_card', '49.50');
    await parent.page.reload({ waitUntil: 'domcontentloaded' });
    await expect(payments).toContainText('$150.00');
    await expect(payments).toContainText('$0.00');
    assert.equal(await payments.locator('.border-top').count(), 3);
    assert.equal(await payments.locator('a[href*="giving.myparishsoft"]').count(), 0);
    await admin.page.goto(check.url);
    await expect(admin.page.locator('.receipt-amount')).toHaveText('$25.50');
    const forbiddenParent = await parent.context.request.get(base + '/admin/students');
    assert.equal(forbiddenParent.status(), 403);
    console.log('PASS: admin check/card installments, duplicate form retry, parent history and balances, stable original receipt, parent admin restriction.');

    for (const [key, classKey, rowId] of [['catechist', 'child', fixture.registrationId], ['leader', 'parent', fixture.familyId]]) {
      const staff = await login(key);
      await expect(staff.page.locator('#teaching-heading')).toBeVisible();
      const classId = fixture.classes[classKey];
      await staff.page.goto(base + `/admin/classes/${classId}?date=${fixture.date}`);
      const button = staff.page.locator(`.present-btn[data-student-id="${rowId}"]`);
      await expect(button).toBeVisible();
      const saved = staff.page.waitForResponse(response => response.url().endsWith(`/admin/classes/${classId}/attendance`) && response.request().method() === 'POST');
      await button.click();
      assert.equal((await saved).status(), 200);
      await staff.page.reload();
      await expect(button).toHaveClass(/active/);
      const calendar = await staff.context.request.get(base + `/calendar/class/${classId}`);
      assert.equal(calendar.status(), 200);
      for (const action of ['attendance', 'tables/assign', 'tables/organize']) {
        const response = await staff.context.request.post(base + `/admin/classes/${fixture.classes.unassigned}/${action}`, {
          form: { student_registration_id: rowId, session_date: fixture.date, status: 'present', table_count: 2, table_number: '1' },
        });
        assert.equal(response.status(), 403);
      }
      const unassigned = await staff.context.request.get(base + `/admin/classes/${fixture.classes.unassigned}`, { maxRedirects: 0 });
      assert.equal(unassigned.status(), 302);
      console.log(`PASS: ${key} assigned attendance persists, calendar opens, unassigned class actions denied.`);
      await staff.context.close();
    }
    console.log('All full-app dashboard workflows passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
