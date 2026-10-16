import { expect, test } from '@playwright/test';
import { registerAndVerify, signIn, uniqueEmail } from './helpers.js';

test('an owner receives a purchase with transport costs, pays part and cancels it', async ({
  page,
}, testInfo) => {
  const project = testInfo.project.name;
  const productName = `E2E Rice ${project} ${Date.now()}`;
  const supplierName = `E2E Supplier ${project} ${Date.now()}`;

  const email = uniqueEmail('buyer', project);
  await registerAndVerify(page, email, 'Neema Buyer');
  await signIn(page, email);
  await page.getByRole('link', { name: 'Create a shop' }).click();
  await page.getByLabel('Shop name').fill(`Buying shop ${project}`);
  await page.getByRole('button', { name: 'Create shop' }).click();

  // A product sold in pieces and cartons of 12, with no stock yet.
  await page.getByRole('link', { name: 'Products' }).click();
  await page.getByRole('link', { name: 'Add product' }).click();
  await page.getByLabel('Product name').fill(productName);
  await page.locator('#base-unit-name').fill('piece');
  await page.getByRole('button', { name: 'Add another unit' }).click();
  await page.locator('#unit-0-name').fill('carton');
  await page.locator('#unit-0-conversion').fill('12');
  await page.getByRole('button', { name: 'Save product' }).click();
  await expect(
    page.getByRole('heading', { name: productName, level: 1 }),
  ).toBeVisible();

  // Add the supplier.
  await page.goto('/suppliers');
  await expect(page.getByTestId('suppliers-empty')).toBeVisible();
  await page.getByRole('button', { name: 'Add supplier' }).click();
  await page.getByLabel('Name').fill(supplierName);
  await page.getByRole('button', { name: 'Save supplier' }).click();
  await expect(
    page.getByRole('heading', { name: supplierName, level: 1 }),
  ).toBeVisible();

  // The goods arrive: 2 cartons at 21,600 plus 1,200 transport (test
  // amounts only). 4,400 is paid on arrival.
  await page.getByRole('link', { name: 'New purchase' }).click();
  await expect(page.getByLabel('Supplier', { exact: true })).toHaveValue(/.+/);
  await page.getByLabel('Add a product').fill(productName);
  await page
    .getByTestId('product-results')
    .getByRole('button', { name: productName })
    .click();
  const line = page.getByTestId('purchase-lines').getByRole('listitem');
  await line.getByLabel('Unit').selectOption({ label: 'carton' });
  await line.getByLabel('Quantity').fill('2');
  await line.getByLabel('Cost per carton (TZS)').fill('21,600');
  await page.getByRole('button', { name: 'Add extra cost' }).click();
  await page.getByLabel('Description').fill('Transport');
  await page.getByLabel('Amount (TZS)', { exact: true }).fill('1200');
  await expect(page.getByTestId('form-total')).toHaveText('TZS 44,400');
  await page.getByLabel('Amount paid (TZS)').fill('4400');
  await page.getByRole('button', { name: 'Save and receive goods' }).click();

  await expect(
    page.getByRole('heading', { name: 'Purchase #1', level: 1 }),
  ).toBeVisible();
  await expect(page.getByTestId('purchase-status')).toHaveText('Received');
  await expect(page.getByTestId('purchase-total')).toHaveText('TZS 44,400');
  // (43,200 + 1,200) / 24 pieces.
  await expect(page.getByTestId('purchase-detail-lines')).toContainText(
    'cost with extras TZS 1,850 per base unit',
  );

  // Stock went up by 24 pieces; the supplier is owed the rest.
  await page.getByRole('link', { name: productName }).click();
  await expect(page.getByTestId('stock-quantity')).toHaveText('24 piece');
  await expect(page.getByTestId('movement-history')).toContainText(
    'Received from supplier',
  );
  await page.goto('/suppliers');
  await page.getByRole('link', { name: new RegExp(supplierName) }).click();
  await expect(page.getByTestId('supplier-balance')).toHaveText(
    'Owed TZS 40,000',
  );
  const history = page.getByTestId('supplier-history');
  await expect(history.getByRole('listitem').first()).toContainText('Payment');

  // The supplier takes the goods back: cancelling reverses the stock and
  // the charge, and the 4,400 paid is now owed back to the shop.
  await history.getByRole('link', { name: 'Purchase #1' }).first().click();
  await page.getByRole('button', { name: 'Cancel purchase' }).click();
  await page.getByLabel('Reason').fill('Supplier took the goods back');
  await page.getByRole('button', { name: 'Confirm cancel' }).click();
  await expect(page.getByTestId('purchase-status')).toHaveText('Cancelled');
  await page.getByRole('link', { name: supplierName }).click();
  await expect(page.getByTestId('supplier-balance')).toHaveText(
    'Owes you TZS 4,400',
  );
  await page.goto('/products');
  await page.getByRole('link', { name: new RegExp(productName) }).click();
  await expect(page.getByTestId('stock-quantity')).toHaveText('0 piece');
});
