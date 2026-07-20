import { test, expect } from '@playwright/test';

/**
 * Credential-free smoke tests against a running build.
 * Confirms the app boots, routes render, and Supabase env is wired.
 */
test.describe('App smoke', () => {
  test('landing page loads with Fresh Delivery branding', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();
    await expect(page.getByText(/Fresh Delivery|delivery|παραγγελ/i).first()).toBeVisible({
      timeout: 20_000,
    });

    const fatal = errors.filter(
      (m) => /Missing VITE_SUPABASE|supabaseUrl is required|supabaseKey is required/i.test(m),
    );
    expect(fatal, `Fatal boot errors: ${fatal.join(' | ')}`).toEqual([]);
  });

  test('customer order route renders', async ({ page }) => {
    await page.goto('/order');
    await expect(page.locator('body')).toBeVisible();
    // App shell should appear (loading spinner clears or content shows)
    await expect(page.locator('#root')).not.toBeEmpty({ timeout: 20_000 });
    // Either stores list, empty state, or search/header from customer app
    await expect(
      page.getByText(/εστιατόρ|restaurant|κατάστημα|αναζήτ|search|Fresh|παραγγελ/i).first(),
    ).toBeVisible({ timeout: 25_000 });
  });

  test('auth page renders login form', async ({ page }) => {
    await page.goto('/auth');
    await expect(page.locator('#root')).not.toBeEmpty({ timeout: 15_000 });
    await expect(
      page.getByRole('button', { name: /σύνδεση|login|sign.?in|εγγραφ|sign.?up|google/i }).first(),
    ).toBeVisible({ timeout: 20_000 });
  });

  test('Supabase REST is reachable from the browser context', async ({ request }) => {
    const url = process.env.VITE_SUPABASE_URL;
    const key = process.env.VITE_SUPABASE_ANON_KEY;
    test.skip(!url || !key, 'VITE_SUPABASE_* not set');

    const res = await request.get(`${url}/rest/v1/menu_items?select=id&limit=1`, {
      headers: {
        apikey: key!,
        Authorization: `Bearer ${key}`,
      },
    });
    expect(res.status(), await res.text()).toBeLessThan(400);
    const rows = await res.json();
    expect(Array.isArray(rows)).toBeTruthy();
    expect(rows.length).toBeGreaterThan(0);
  });

  test('protected /driver redirects unauthenticated users', async ({ page }) => {
    await page.goto('/driver');
    // Should end up on auth or show login gate, not a blank crash
    await page.waitForTimeout(1500);
    const path = new URL(page.url()).pathname;
    const bodyText = await page.locator('body').innerText();
    const redirectedOrGated =
      path.includes('auth') ||
      /σύνδεση|login|sign.?in|δεν.?έχετε|unauthorized|access/i.test(bodyText);
    expect(redirectedOrGated, `url=${page.url()} body=${bodyText.slice(0, 200)}`).toBeTruthy();
  });
});
