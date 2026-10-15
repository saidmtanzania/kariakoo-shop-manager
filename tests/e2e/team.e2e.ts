import { expect, test, type Page } from '@playwright/test';
import {
  linkFromLatestEmail,
  PASSWORD,
  registerAndVerify,
  signIn,
  uniqueEmail,
} from './helpers.js';

async function ownerWithShop(page: Page, email: string, shopName: string) {
  await registerAndVerify(page, email, 'Asha Owner');
  await signIn(page, email);
  await page.getByRole('link', { name: 'Create a shop' }).click();
  await page.getByLabel('Shop name').fill(shopName);
  await page.getByRole('button', { name: 'Create shop' }).click();
  await expect(page.getByTestId('active-shop-name')).toHaveText(shopName);
}

test('an owner invites a cashier, who joins and gets only cashier access', async ({
  browser,
  page,
}, testInfo) => {
  const ownerEmail = uniqueEmail('teamowner', testInfo.project.name);
  const staffEmail = uniqueEmail('cashier', testInfo.project.name);
  const shopName = `Team shop ${testInfo.project.name}`;
  await ownerWithShop(page, ownerEmail, shopName);

  await page.getByRole('link', { name: 'Team' }).click();
  await expect(
    page.getByRole('heading', { name: 'Team', level: 1 }),
  ).toBeVisible();
  await expect(page.getByTestId('role-Cashier')).toBeVisible();

  await page.getByLabel('Email').fill(staffEmail);
  await page.getByRole('checkbox', { name: 'Cashier' }).check();
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(
    page.getByText(`Invitation sent to ${staffEmail}.`),
  ).toBeVisible();
  await expect(page.getByTestId(`invitation-${staffEmail}`)).toContainText(
    'Pending',
  );

  // The cashier, in their own browser, creates an account and opens the link.
  const staffContext = await browser.newContext();
  const staff = await staffContext.newPage();
  await registerAndVerify(staff, staffEmail, 'Baraka Cashier');
  const link = new URL(await linkFromLatestEmail(staffEmail, /join/i));
  await staff.goto(`${link.pathname}${link.hash}`);
  await expect(staff.getByTestId('invitation-summary')).toHaveText(
    `Asha Owner invited you to join ${shopName}.`,
  );
  await expect(staff).not.toHaveURL(/token=/);

  await staff.getByRole('link', { name: 'Sign in' }).click();
  await staff.getByLabel('Email').fill(staffEmail);
  await staff.getByLabel('Password').fill(PASSWORD);
  await staff.getByRole('button', { name: 'Sign in' }).click();
  await expect(staff).toHaveURL(/\/invitations\/accept$/);
  await staff.getByRole('button', { name: 'Accept and join' }).click();

  await expect(staff.getByTestId('active-shop-name')).toHaveText(shopName);
  await expect(staff.getByRole('link', { name: 'Team' })).toHaveCount(0);
  await staff.goto('/team');
  await expect(
    staff.getByText('You do not have permission to see the team.'),
  ).toBeVisible();

  // The owner sees the new member with the Cashier role.
  await page.reload();
  const row = page.getByTestId(`member-${staffEmail}`);
  await expect(row).toContainText('Baraka Cashier');
  await expect(row).toContainText('Cashier');
  await expect(page.getByTestId(`invitation-${staffEmail}`)).toContainText(
    'Accepted',
  );
  await staffContext.close();
});

test('an owner creates a custom role and a link cannot be used by another account', async ({
  browser,
  page,
}, testInfo) => {
  const ownerEmail = uniqueEmail('roleowner', testInfo.project.name);
  await ownerWithShop(page, ownerEmail, `Role shop ${testInfo.project.name}`);
  await page.goto('/team');

  await page.getByRole('button', { name: 'New role' }).click();
  await page.getByLabel('Role name').fill('Stock checker');
  await page.getByRole('checkbox', { name: 'See stock' }).check();
  await page.getByRole('checkbox', { name: 'See products' }).check();
  await page.getByRole('button', { name: 'Save role' }).click();
  const role = page.getByTestId('role-Stock checker');
  await expect(role).toContainText('2 permissions');

  // Invite someone to it; a different signed-in account cannot accept.
  const invitedEmail = uniqueEmail('checker', testInfo.project.name);
  await page.getByLabel('Email').fill(invitedEmail);
  await page.getByRole('checkbox', { name: 'Stock checker' }).check();
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByTestId(`invitation-${invitedEmail}`)).toContainText(
    'Pending',
  );

  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  const otherEmail = uniqueEmail('intruder', testInfo.project.name);
  await registerAndVerify(other, otherEmail, 'Other Person');
  await signIn(other, otherEmail);
  await expect(
    other.getByRole('heading', { name: 'Create your first shop' }),
  ).toBeVisible();
  const link = new URL(await linkFromLatestEmail(invitedEmail, /join/i));
  await other.goto(`${link.pathname}${link.hash}`);
  await expect(
    other.getByText(`You are signed in as ${otherEmail}.`, { exact: false }),
  ).toBeVisible();
  await expect(
    other.getByRole('button', { name: 'Accept and join' }),
  ).toHaveCount(0);

  // The owner cancels it and the link stops working.
  await page
    .getByTestId(`invitation-${invitedEmail}`)
    .getByRole('button', { name: 'Cancel invitation' })
    .click();
  await expect(page.getByTestId(`invitation-${invitedEmail}`)).toContainText(
    'Cancelled',
  );
  // Leave the page first: opening the same path with only a new fragment
  // would not load it again.
  await other.goto('/');
  await other.goto(`${link.pathname}${link.hash}`);
  await expect(other.getByText('This invitation was cancelled.')).toBeVisible();
  await otherContext.close();
});
