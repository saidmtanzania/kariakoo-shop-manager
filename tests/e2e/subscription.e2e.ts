import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { registerAndVerify, signIn, uniqueEmail } from './helpers.js';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://ksm:ksm_local_password@localhost:5432/ksm?schema=public';

/** Makes someone platform staff with the real command (the only way to do it). */
function grantPlatformAdmin(email: string): void {
  execFileSync(
    'node',
    [
      resolve(
        import.meta.dirname,
        '../../backend/dist/cli/grant-platform-admin.js',
      ),
      'grant',
      email,
    ],
    {
      env: {
        ...process.env,
        NODE_ENV: 'production',
        DATABASE_URL,
        WEB_ORIGIN: 'http://localhost:3000',
      },
      stdio: 'pipe',
    },
  );
}

test('a shop pays manually and platform staff confirm it', async ({
  browser,
  page,
}, testInfo) => {
  const project = testInfo.project.name;
  const suffix = `${project}-${Date.now()}`;
  const planName = `E2E Monthly ${suffix}`;
  const reference = `E2E${Date.now()}${project === 'mobile-chromium' ? 'M' : 'D'}`;

  // Platform staff add a plan (prices are entered by people, never invented).
  const adminEmail = uniqueEmail('platform', project);
  await registerAndVerify(page, adminEmail, 'Pili Platform');
  grantPlatformAdmin(adminEmail);
  await signIn(page, adminEmail);
  await page.getByRole('link', { name: 'Platform admin' }).click();
  await expect(
    page.getByRole('heading', { name: 'Platform admin', level: 1 }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'New plan' }).click();
  await page
    .getByLabel('Code (fixed once saved)')
    .fill(`e2e-${suffix}`.toLowerCase().slice(0, 40));
  await page.getByLabel('Name', { exact: true }).fill(planName);
  await page.getByLabel('Billing period').selectOption('MONTH');
  await page.getByLabel('Price (TZS)').fill('15000');
  await page.getByLabel('Limit for Staff seats').fill('3');
  await page.getByRole('button', { name: 'Save' }).first().click();
  await expect(page.getByTestId('platform-plans')).toContainText(planName);

  // The owner, on their own device, starts in the free trial and pays.
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  const ownerEmail = uniqueEmail('payer', project);
  await registerAndVerify(owner, ownerEmail, 'Neema Owner');
  await signIn(owner, ownerEmail);
  await owner.getByRole('link', { name: 'Create a shop' }).click();
  await owner.getByLabel('Shop name').fill(`Paying shop ${project}`);
  await owner.getByRole('button', { name: 'Create shop' }).click();
  await owner.getByRole('link', { name: 'Subscription' }).click();
  await expect(owner.getByTestId('subscription-status')).toHaveText(
    'Free trial',
  );

  await owner.getByRole('radio', { name: new RegExp(planName) }).check();
  await expect(owner.getByText('Amount to pay: TZS 15,000')).toBeVisible();
  await owner.getByLabel('Transaction reference').fill(reference);
  await owner.getByRole('button', { name: 'Send for confirmation' }).click();
  await expect(owner.getByTestId('payment-waiting')).toBeVisible();
  await expect(owner.getByTestId(`payment-${reference}`)).toContainText(
    'Waiting for confirmation',
  );
  // Nothing changes until it is confirmed.
  await expect(owner.getByTestId('paid-until')).toHaveCount(0);

  // Platform staff confirm it.
  await page.reload();
  const row = page.getByTestId(`platform-payment-${reference}`);
  await expect(row).toContainText(planName);
  await expect(row).toContainText('TZS 15,000');
  await row.getByRole('button', { name: 'Confirm payment' }).click();
  await expect(row).toHaveCount(0);

  // The owner sees the payment confirmed and the paid-until date.
  await owner.reload();
  await expect(owner.getByTestId(`payment-${reference}`)).toContainText(
    'Confirmed',
  );
  await expect(owner.getByTestId('paid-until')).toBeVisible();
  await ownerContext.close();
});

test('a shop owner cannot open the platform admin page', async ({
  page,
}, testInfo) => {
  const email = uniqueEmail('notadmin', testInfo.project.name);
  await registerAndVerify(page, email, 'Juma Owner');
  await signIn(page, email);
  await expect(
    page.getByRole('heading', { name: 'Create your first shop' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Platform admin' })).toHaveCount(
    0,
  );
  await page.goto('/platform');
  await expect(
    page.getByText('This page is for platform staff only.'),
  ).toBeVisible();
});
