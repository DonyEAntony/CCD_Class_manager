require('dotenv').config({ quiet: true });
const fs = require('fs');
const { chromium } = require('playwright');
const { expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fixture = JSON.parse(fs.readFileSync('test-results/family-balance-e2e.json'));
const base = 'http://127.0.0.1:3197';
(async () => {
  if (process.env.DB_NAME !== 'u733721250_faithformtest') throw Error('Requires designated test database');
  const browser = await chromium.launch();
  try {
    async function login(email,password) {
      const context = await browser.newContext();
      await context.route('https://cdn.jsdelivr.net/**', route=>route.fulfill({path:'test-results/'+(route.request().url().endsWith('.css')?'bootstrap.min.css':'bootstrap.bundle.min.js')}));
      await context.route('https://fonts.googleapis.com/**',route=>route.abort());
      const page = await context.newPage();
      await page.goto(base+'/login',{waitUntil:'domcontentloaded'});
      await page.locator('[name="email"]').fill(email); await page.locator('[name="password"]').fill(password);
      await page.locator('form[action="/login"] button[type="submit"]').click();
      await expect(page).toHaveURL(base+'/dashboard');
      return page;
    }
    const parent = await login(fixture.email,fixture.password);
    const card = parent.locator('section').filter({has:parent.locator('#payment-heading')});
    await expect(card).toContainText('$275.00');
    await expect(card.locator('a[href*="giving.myparishsoft"]')).toBeVisible();
    const admin = await login(fixture.admin.email,fixture.adminPassword);
    async function assertNoQueue() {
      await admin.goto(base+'/dashboard',{waitUntil:'domcontentloaded'});
      await expect(admin.locator('#attention-heading')).toBeVisible();
      assert.ok(!(await admin.locator('section').filter({has:admin.locator('#attention-heading')}).innerText()).includes('Balance Test One'));
      // innerText excludes collapsed content; textContent verifies every queued record.
      assert.ok(!(await admin.locator('section').filter({has:admin.locator('#attention-heading')}).textContent()).includes('Balance Test One'));
    }
    await assertNoQueue();
    const { appendPayment, importKey } = require('../payment-ledger');
    await appendPayment(require('../db'),{key:importKey('FAMILY-E2E-'+fixture.userId),transactionId:'FAMILY-E2E-'+fixture.userId,amount:200,date:new Date().toISOString().slice(0,10),method:'imported',recordedBy:fixture.admin.id},fixture.children);
    await parent.reload({waitUntil:'domcontentloaded'});
    await expect(card).toContainText('$75.00');
    assert.equal(await card.locator('.border-top').count(),1);
    await expect(card.locator('a[href*="giving.myparishsoft"]')).toBeVisible();
    const studentId=fixture.children[0].studentId;
    await admin.goto(base+`/admin/students?status=all#student-detail-${studentId}`,{waitUntil:'domcontentloaded'});
    const form=admin.locator(`form[action="/admin/students/${studentId}/payment"]`);
    await form.locator('[name="amount"]').fill('75.00');
    await form.locator('[name="method"]').selectOption('check');
    await form.locator('button[type="submit"]').click();
    await expect(admin.locator('.receipt-amount')).toHaveText('$75.00');
    await parent.reload({waitUntil:'domcontentloaded'});
    await expect(card).toContainText('$0.00');
    assert.equal(await card.locator('.border-top').count(),2);
    assert.equal(await card.locator('a[href*="giving.myparishsoft"]').count(),0);
    await assertNoQueue();
    await parent.setViewportSize({width:390,height:900});
    await parent.screenshot({path:'test-results/family-balance-paid.png',fullPage:true});
    console.log('PASS: two-child family $275 unpaid -> $75 after one shared $200 import -> $0 after $75 check; correct button visibility and no false admin confirmation queue.');
  } finally { await browser.close(); }
  process.exit(0);
})().catch(e=>{console.error(e.code||e.message);process.exit(1);});
