const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('protected pages redirect anonymous users to login', async ({ page }) => {
  await page.goto('/registration/children');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator('form[action="/login"]')).toBeVisible();
});

test('user must verify email before login and can then exercise the child registration UI', async ({ page }) => {
  const email = `playwright-${Date.now()}@example.com`;
  const password = 'PlaywrightPass123!';

  await page.goto('/signup');
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="firstName"]').fill('Playwright');
  await page.locator('input[name="lastName"]').fill('User');
  await page.locator('input[name="phone"]').fill('555-111-2222');
  await page.locator('input[name="password"]').fill(password);
  await page.locator('form[action="/signup"] button[type="submit"]').click();

  await expect(page.getByRole('heading', { name: /verify your email/i })).toBeVisible();
  const activationLink = page.getByRole('link', { name: /activate this test account/i });
  await expect(activationLink).toBeVisible();
  const activationHref = await activationLink.getAttribute('href');
  expect(activationHref).toContain('/verify-email?token=');

  await page.goto('/login');
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('form[action="/login"] button[type="submit"]').click();

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText(/please verify your email before logging in/i)).toBeVisible();

  await page.goto(activationHref);
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText(/email verified for/i)).toBeVisible();

  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('form[action="/login"] button[type="submit"]').click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('link', { name: /calendar/i })).toBeVisible();

  await page.goto('/registration/children');
  await expect(page.locator('form[action="/registration/children"]')).toBeVisible();

  await page.locator('#primary_contact_relationship').selectOption('Other');
  await expect(page.locator('#relationship-other-wrap')).toBeVisible();
  await page.locator('#primary_contact_relationship_other').fill('Aunt');

  await page.locator('input[name="primary_contact_first_name"]').fill('Maria');
  await page.locator('input[name="primary_contact_last_name"]').fill('Lopez');
  await page.locator('input[name="primary_contact_phone"]').fill('555-123-4567');
  await page.locator('input[name="primary_contact_email"]').fill(email);
  await page.locator('select[name="primary_contact_religion"]').selectOption('Catholic');
  await page.locator('input[name="address"]').fill('123 Main St');
  await page.locator('input[name="city"]').fill('Charlotte');
  await page.locator('select[name="state"]').selectOption('NC');
  await page.locator('input[name="zip"]').fill('28202');

  await page.locator('input[name="student_first_name[]"]').fill('Sofia');
  await page.locator('input[name="student_last_name[]"]').fill('Lopez');
  await page.locator('select[name="student_gender[]"]').selectOption('female');
  await page.locator('input[name="student_dob[]"]').fill('2016-05-20');

  const submitButton = page.getByRole('button', { name: /submit registration/i });
  await expect(submitButton).toBeEnabled();

  await page.locator('#add-child').click();
  await expect(page.locator('.child-block')).toHaveCount(2);
  await expect(page.locator('.remove-child-btn').nth(0)).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#save-draft').click();

  const savedDraft = JSON.parse(
    await page.evaluate(() => window.localStorage.getItem('registration-draft'))
  );
  expect(savedDraft.primary_contact_first_name).toBe('Maria');
  expect(savedDraft['student_first_name[]'][0]).toBe('Sofia');
});
