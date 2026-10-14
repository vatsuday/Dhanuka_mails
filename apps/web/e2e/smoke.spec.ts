import { expect, test } from '@playwright/test';

test('the health page loads in a real browser', async ({ page }) => {
  const response = await page.goto('/health');
  expect(response?.status()).toBe(200);
  expect(JSON.parse(await page.locator('body').innerText())).toEqual({ status: 'ok' });
});

test('the ready page reports ready with no dependency checks', async ({ request }) => {
  const response = await request.get('/ready');
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: 'ready', checks: [] });
});

test('the home page renders', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Dhanuka Mails');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dhanuka Mails');
});

test('the server does not advertise its framework', async ({ request }) => {
  const response = await request.get('/health');
  expect(response.headers()['x-powered-by']).toBeUndefined();
});
