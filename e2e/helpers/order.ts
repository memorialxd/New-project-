import { Page, expect } from '@playwright/test';

const STORE_ID = process.env.E2E_STORE_ID!;

/** Place a new order as a logged-in customer and return its id (read from URL). */
export async function placeOrder(page: Page): Promise<string> {
  await page.goto(`/restaurant/${STORE_ID}`);
  // First available menu item
  await page.getByRole('button', { name: /προσθήκη|add/i }).first().click();
  await page.getByRole('button', { name: /καλάθι|cart|checkout/i }).first().click();
  await page.waitForURL(/\/checkout/);
  // Cash on delivery — least flaky path
  const cashOption = page.getByRole('radio', { name: /μετρητά|cash/i });
  if (await cashOption.count()) await cashOption.check();
  await page.getByRole('button', { name: /πληρωμή|παραγγελία|place order/i }).click();
  await page.waitForURL(/\/orders\/([0-9a-f-]{36})/i, { timeout: 30_000 });
  const m = page.url().match(/\/orders\/([0-9a-f-]{36})/i);
  expect(m, 'order id in URL').toBeTruthy();
  return m![1];
}

/** Wait until an order card with this id (or short id) appears in the active list. */
export async function waitForOrderCard(page: Page, orderId: string) {
  const short = orderId.slice(0, 8);
  await expect(
    page.getByText(new RegExp(short, 'i')).first()
  ).toBeVisible({ timeout: 30_000 });
}
