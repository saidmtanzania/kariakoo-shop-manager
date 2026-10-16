import { expect, test } from '@playwright/test';
import { registerAndVerify, signIn, uniqueEmail } from './helpers.js';

test('an owner adds a product with cartons, records stock and adjusts it', async ({
  page,
}, testInfo) => {
  const project = testInfo.project.name;
  const productName = `E2E Sugar ${project} ${Date.now()}`;

  const email = uniqueEmail('stock', project);
  await registerAndVerify(page, email, 'Baraka Stock');
  await signIn(page, email);
  await page.getByRole('link', { name: 'Create a shop' }).click();
  await page.getByLabel('Shop name').fill(`Stock shop ${project}`);
  await page.getByRole('button', { name: 'Create shop' }).click();

  await page.getByRole('link', { name: 'Products' }).click();
  await expect(
    page.getByRole('heading', { name: 'Products', level: 1 }),
  ).toBeVisible();
  await expect(page.getByText('No products yet.')).toBeVisible();
  await page.getByRole('link', { name: 'Add product' }).click();

  // A piece is the base unit; a carton holds 12 pieces. Test prices only.
  await page.getByLabel('Product name').fill(productName);
  await page.locator('#base-unit-name').fill('piece');
  await page.locator('#base-retail').fill('1500');
  await page.getByLabel('Reorder level (piece)').fill('30');
  await page.getByRole('button', { name: 'Add another unit' }).click();
  await page.locator('#unit-0-name').fill('carton');
  await page.locator('#unit-0-conversion').fill('12');
  await page.locator('#unit-0-wholesale').fill('16000');
  await page.getByLabel('Quantity').fill('2');
  await page.locator('#opening-unit').selectOption('carton');
  await page.getByRole('button', { name: 'Save product' }).click();

  // Two cartons of opening stock are 24 pieces.
  await expect(
    page.getByRole('heading', { name: productName, level: 1 }),
  ).toBeVisible();
  await expect(page.getByTestId('stock-quantity')).toHaveText('24 piece');
  await expect(page.getByText('1 carton = 12 piece')).toBeVisible();

  // One carton is damaged: the adjustment is entered in cartons.
  const adjust = page.getByTestId('adjust-form');
  await adjust.getByLabel('Remove stock').check();
  await adjust.getByLabel('Quantity', { exact: true }).fill('1');
  await adjust.getByLabel('Unit').selectOption({ label: 'carton' });
  await adjust.getByLabel('Reason').selectOption('DAMAGED');
  await adjust.getByRole('button', { name: 'Save adjustment' }).click();
  await expect(adjust.getByText('Saved. Stock is now 12 piece.')).toBeVisible();
  await expect(page.getByTestId('stock-quantity')).toHaveText('12 piece');

  // Removing more than is in stock is refused, and nothing changes.
  await adjust.getByLabel('Quantity', { exact: true }).fill('2');
  await adjust.getByLabel('Unit').selectOption({ label: 'carton' });
  await adjust.getByRole('button', { name: 'Save adjustment' }).click();
  await expect(
    adjust.getByText('There is not enough stock for this change.'),
  ).toBeVisible();
  await expect(page.getByTestId('stock-quantity')).toHaveText('12 piece');

  // The history keeps who changed what, in the unit they used.
  const history = page.getByTestId('movement-history');
  await expect(history.getByRole('listitem')).toHaveCount(2);
  await expect(history.getByRole('listitem').first()).toContainText(
    'Removed · Damaged',
  );
  await expect(history.getByRole('listitem').first()).toContainText(
    'Entered 1 carton · balance 12',
  );
  await expect(history.getByRole('listitem').last()).toContainText(
    'Opening stock',
  );

  // 12 pieces is below the reorder level of 30: the list flags it.
  await page.getByRole('link', { name: 'All products' }).click();
  await expect(page.getByTestId('low-stock-alert')).toContainText(
    '1 product is at or below the reorder level.',
  );
  await page.getByLabel('Search').fill('sugar');
  await expect(page.getByText(productName)).toBeVisible();
  await expect(page.getByText('12 piece in stock')).toBeVisible();

  // The inventory page shows the same counts and a clean reconciliation.
  await page.goto('/inventory');
  await expect(page.getByTestId('summary-products')).toContainText('1');
  await expect(page.getByTestId('summary-low')).toContainText('1');
  await expect(page.getByTestId('negative-setting')).toHaveText(
    'Sales cannot take stock below zero.',
  );
  await page.getByRole('button', { name: 'Run check' }).click();
  await expect(page.getByTestId('reconcile-result')).toHaveText(
    '1 product checked. It matches its history.',
  );
  await expect(page.getByTestId('recent-movements')).toContainText(productName);
});
