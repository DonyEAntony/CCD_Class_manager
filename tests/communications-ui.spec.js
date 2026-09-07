const { test, expect } = require('@playwright/test');
const path = require('path');

test('parent and catechist exchange messages and unread state clears on opening', async ({ browser }) => {
  const parent = await browser.newContext();
  const teacher = await browser.newContext();
  const parentPage = await parent.newPage();
  const teacherPage = await teacher.newPage();
  await parentPage.goto('/__test/as/1');
  await expect(parentPage.getByText('1 unread')).toBeVisible();
  await parentPage.locator('.conversation-link').click();
  await parentPage.getByLabel('Your message').fill('Can Sofia bring her workbook this Sunday?');
  await parentPage.getByRole('button', { name: 'Send reply' }).click();
  await expect(parentPage.getByText('Can Sofia bring her workbook this Sunday?', { exact: true })).toBeVisible();
  await teacherPage.goto('/__test/as/2');
  await expect(teacherPage.getByText('1 unread')).toBeVisible();
  await teacherPage.locator('.conversation-link').click();
  await teacherPage.getByLabel('Your message').fill('Yes, please bring it. We will use it during the lesson.');
  await teacherPage.getByRole('button', { name: 'Send reply' }).click();
  await parentPage.getByRole('link', { name: 'Refresh latest messages' }).click();
  await expect(parentPage.getByText('Yes, please bring it. We will use it during the lesson.', { exact: true })).toBeVisible();
  await parentPage.screenshot({ path: path.resolve('test-results/communications-conversation-desktop.png'), fullPage: true });
  await parentPage.getByRole('link', { name: 'All conversations' }).click();
  await expect(parentPage.getByText(/\d+ unread/)).toHaveCount(0);
  await parent.close();
  await teacher.close();
});

test('class reminders and email preferences persist through the forms', async ({ page }) => {
  await page.goto('/__test/as/2');
  await page.goto('/messages/classes/10/reminders');
  await page.getByRole('switch', { name: 'Enable class reminders' }).check();
  await page.getByLabel('Send before class').selectOption('2');
  await page.getByLabel(/Delivery time/).selectOption('17');
  await page.getByRole('button', { name: 'Save reminders' }).click();
  await expect(page.getByRole('switch')).toBeChecked();
  await expect(page.getByLabel('Send before class')).toHaveValue('2');
  await expect(page.getByLabel(/Delivery time/)).toHaveValue('17');
  const cards = page.locator('.row > section');
  const first = await cards.nth(0).boundingBox();
  const second = await cards.nth(1).boundingBox();
  expect(second.x).toBeGreaterThan(first.x + first.width);
  await page.screenshot({ path: path.resolve('test-results/communications-reminders-desktop.png'), fullPage: true });
  await page.goto('/__test/as/1');
  await page.getByLabel('Class reminder emails', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await expect(page.getByLabel('Class reminder emails', { exact: true })).not.toBeChecked();
});

test('mobile inbox and Spanish labels fit the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/__test/as/1?lang=es');
  await expect(page.getByRole('heading', { name: 'Mensajes', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Guardar preferencias' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const select = await page.locator('#family-class').boundingBox();
  expect(select.x + select.width).toBeLessThan(390);
  await page.screenshot({ path: path.resolve('test-results/communications-inbox-mobile.png'), fullPage: true });
});
