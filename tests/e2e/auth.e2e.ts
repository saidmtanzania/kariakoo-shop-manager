import { expect, test } from '@playwright/test';
import {
  linkFromLatestEmail,
  PASSWORD,
  registerAndVerify,
  signIn,
  uniqueEmail,
} from './helpers.js';

test('a new owner registers, confirms the email, signs in, creates a shop and signs out', async ({
  page,
  context,
}, testInfo) => {
  const email = uniqueEmail('owner', testInfo.project.name);
  await registerAndVerify(page, email, 'Asha Juma');

  await signIn(page, email);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('signed-in-as')).toHaveText(
    'Signed in as Asha Juma',
  );
  await expect(
    page.getByRole('heading', { name: 'Create your first shop' }),
  ).toBeVisible();

  // The session cookie is HttpOnly, so page scripts can never read it.
  const cookie = (await context.cookies()).find((c) =>
    c.name.endsWith('ksm_session'),
  );
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax' });
  expect(await page.evaluate(() => document.cookie)).not.toContain(
    'ksm_session',
  );

  await page.getByRole('link', { name: 'Create a shop' }).click();
  await page.getByLabel('Shop name').fill('Asha Electronics');
  await page.getByLabel('Phone (optional)').fill('+255 712 345 678');
  await page.getByLabel('Type of business').selectOption('WHOLESALE');
  await page.getByRole('button', { name: 'Create shop' }).click();
  await expect(page.getByTestId('active-shop-name')).toHaveText(
    'Asha Electronics',
  );
  await expect(
    page.locator('dd').getByText('Wholesale', { exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
});

test('sign-in is refused before the email is confirmed and with a wrong password', async ({
  page,
}, testInfo) => {
  const email = uniqueEmail('unverified', testInfo.project.name);
  await page.goto('/register');
  await page.getByLabel('Full name').fill('Juma');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(
    page.getByRole('heading', { name: 'Check your email' }),
  ).toBeVisible();

  await signIn(page, email);
  await expect(page.locator('[data-slot=alert]')).toContainText(
    'Confirm your email address',
  );

  await signIn(page, email, 'not the password');
  await expect(page.locator('[data-slot=alert]')).toContainText(
    'Email or password is incorrect',
  );
});

test('a forgotten password is reset through the emailed link', async ({
  page,
}, testInfo) => {
  const email = uniqueEmail('reset', testInfo.project.name);
  await registerAndVerify(page, email, 'Neema');

  await page.goto('/forgot-password');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(
    page.getByText(`If an account exists for ${email}`),
  ).toBeVisible();

  const link = new URL(
    await linkFromLatestEmail(email, /reset your password/i),
  );
  await page.goto(`${link.pathname}${link.hash}`);
  await page.getByLabel('New password').fill('a new long passphrase');
  await page.getByRole('button', { name: 'Save new password' }).click();
  await expect(page.getByText('Your password has been changed')).toBeVisible();

  await signIn(page, email, PASSWORD);
  await expect(page.locator('[data-slot=alert]')).toContainText(
    'Email or password is incorrect',
  );
  await signIn(page, email, 'a new long passphrase');
  await expect(page.getByTestId('signed-in-as')).toBeVisible();
});

test('one owner cannot open another owner’s shop', async ({
  browser,
}, testInfo) => {
  const owners = [];
  for (const label of ['alpha', 'beta']) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const email = uniqueEmail(label, testInfo.project.name);
    await registerAndVerify(page, email, `${label} owner`);
    await signIn(page, email);
    await page.getByRole('link', { name: 'Create a shop' }).click();
    await page.getByLabel('Shop name').fill(`${label} shop`);
    await page.getByRole('button', { name: 'Create shop' }).click();
    await expect(page.getByTestId('active-shop-name')).toHaveText(
      `${label} shop`,
    );
    const session = await (
      await page.request.get('/api/v1/auth/session')
    ).json();
    owners.push({ page, context, shopId: session.activeShopId as string });
  }
  const [alpha, beta] = owners as [(typeof owners)[0], (typeof owners)[0]];

  const res = await beta.page.request.put('/api/v1/auth/session/active-shop', {
    data: { shopId: alpha.shopId },
    headers: { 'x-requested-with': 'XMLHttpRequest' },
  });
  expect(res.status()).toBe(404);
  await beta.page.reload();
  await expect(beta.page.getByTestId('active-shop-name')).toHaveText(
    'beta shop',
  );

  for (const owner of owners) await owner.context.close();
});
