// Smoke: Local publisher page — copy, localStorage save/clear; no real Walrus required.

const { test, expect } = require('@playwright/test');

const KEY = 'walforms.localPublisherBaseUrl';

test.describe('Local publisher tab', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/local-publisher.html');
    await page.evaluate((k) => localStorage.removeItem(k), KEY);
  });

  test('shows Using local publisher and saves base URL', async ({ page }) => {
    await expect(page.getByText('Using local publisher').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: /Walrus publisher on your machine/i })).toBeVisible();

    await page.fill('#local-publisher-url', 'http://127.0.0.1:31416');
    await page.getByRole('button', { name: /Save & enable local publisher/i }).click();

    const stored = await page.evaluate((k) => localStorage.getItem(k), KEY);
    expect(stored).toBe('http://127.0.0.1:31416');

    await page.goto('/builder.html');
    const still = await page.evaluate((k) => localStorage.getItem(k), KEY);
    expect(still).toBe('http://127.0.0.1:31416');
  });

  test('clear removes key', async ({ page }) => {
    await page.evaluate(
      (k) => localStorage.setItem(k, 'http://127.0.0.1:31416'),
      KEY,
    );
    await page.reload();
    await page.getByRole('button', { name: /Disable & clear/i }).click();
    const cleared = await page.evaluate((k) => localStorage.getItem(k), KEY);
    expect(cleared).toBeNull();
  });
});
