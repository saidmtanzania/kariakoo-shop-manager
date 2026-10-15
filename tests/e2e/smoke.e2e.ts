import { expect, test } from '@playwright/test';

test('status page shows the app name and a connected API and database', async ({
  page,
}) => {
  await page.goto('/status');

  await expect(
    page.getByRole('heading', { name: 'Kariakoo Shop Manager' }),
  ).toBeVisible();
  await expect(page.getByTestId('status-api')).toHaveAttribute(
    'data-state',
    'connected',
  );
  await expect(page.getByTestId('status-database')).toHaveAttribute(
    'data-state',
    'connected',
  );
});

test('signed-out visitors are sent to sign in', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('API requests go through the web origin so cookies stay first-party', async ({
  request,
}) => {
  const res = await request.get('/api/v1/health');
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ status: 'ok' });
});
