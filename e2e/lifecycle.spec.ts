import { test, expect, BrowserContext, Page } from '@playwright/test';
import { loginAs, users } from './helpers/auth';
import { placeOrder, waitForOrderCard } from './helpers/order';

/**
 * Full delivery lifecycle:
 *   placed → store accepts → ready → driver accepts → picked up → delivered
 *
 * Each stage is asserted on every actor's screen so we catch realtime gaps.
 * Conflict cases enforce the server-side guards:
 *   - driver cannot pick up before the store marks the order `ready`
 *   - driver cannot mark delivered before picking up
 *   - customer cannot cancel after the store has accepted
 *   - the same order cannot be delivered twice
 */

test.describe('Delivery lifecycle — success + conflicts', () => {
  let customerCtx: BrowserContext;
  let storeCtx: BrowserContext;
  let driverCtx: BrowserContext;
  let customer: Page;
  let store: Page;
  let driver: Page;

  test.beforeAll(async ({ browser }) => {
    customerCtx = await browser.newContext();
    storeCtx = await browser.newContext();
    driverCtx = await browser.newContext();
    customer = await loginAs(customerCtx, users.customer);
    store = await loginAs(storeCtx, users.store);
    driver = await loginAs(driverCtx, users.driver);
  });

  test.afterAll(async () => {
    await customerCtx.close();
    await storeCtx.close();
    await driverCtx.close();
  });

  // Convenience matchers
  const accept = (p: Page) => p.getByRole('button', { name: /αποδοχή|accept/i }).first();
  const ready = (p: Page) => p.getByRole('button', { name: /έτοιμη|ready/i }).first();
  const pickup = (p: Page) => p.getByRole('button', { name: /παραλαβή|pick.?up/i }).first();
  const deliver = (p: Page) => p.getByRole('button', { name: /παράδοση|deliver|complete/i }).first();
  const cancel = (p: Page) => p.getByRole('button', { name: /ακύρωση|cancel/i }).first();

  test('success: full lifecycle visible to every actor', async () => {
    const orderId = await placeOrder(customer);
    const short = orderId.slice(0, 8);

    // Stage 1 — store sees it as pending
    await waitForOrderCard(store, orderId);
    await expect(store.getByText(/εκκρεμ|pending|new/i).first()).toBeVisible();

    // Stage 2 — store accepts
    await accept(store).click();
    await expect(store.getByText(/προετοιμασία|accepted|preparing/i).first())
      .toBeVisible({ timeout: 15_000 });

    // Customer tracking reflects "accepted" via realtime
    await customer.goto(`/order-tracking/${orderId}`);
    await expect(customer.getByText(/προετοιμασία|accepted|preparing/i).first())
      .toBeVisible({ timeout: 15_000 });

    // Stage 3 — store marks ready
    await ready(store).click();
    await expect(customer.getByText(/έτοιμη|ready/i).first())
      .toBeVisible({ timeout: 15_000 });

    // Stage 4 — driver offer appears & is accepted (soft reservation)
    await waitForOrderCard(driver, orderId);
    await accept(driver).click();

    // Stage 5 — pickup unlocked because store already marked ready
    await expect(pickup(driver)).toBeVisible({ timeout: 15_000 });
    await pickup(driver).click();
    await expect(customer.getByText(/καθ.?οδόν|on.?the.?way|picked/i).first())
      .toBeVisible({ timeout: 20_000 });

    // Stage 6 — deliver
    await deliver(driver).click();
    await expect(customer.getByText(/παραδόθηκε|delivered/i).first())
      .toBeVisible({ timeout: 20_000 });

    // Stage 7 — order disappears from active queues on store + driver
    await expect(async () => {
      const onStore = await store.getByText(new RegExp(short, 'i')).count();
      const onDriver = await driver.getByText(new RegExp(short, 'i')).count();
      expect(onStore + onDriver).toBe(0);
    }).toPass({ timeout: 30_000 });
  });

  test('conflict: driver cannot pick up before store marks ready', async () => {
    const orderId = await placeOrder(customer);
    await waitForOrderCard(store, orderId);
    await accept(store).click(); // accepted, but NOT ready

    await waitForOrderCard(driver, orderId);
    await accept(driver).click(); // soft reservation only

    // Pickup must be disabled OR clicking it must surface an error toast
    const btn = pickup(driver);
    if (await btn.isVisible().catch(() => false)) {
      const disabled = await btn.isDisabled();
      if (!disabled) {
        await btn.click();
        await expect(
          driver.getByText(/δεν.*έτοιμ|not.*ready|κατάστημα/i).first(),
        ).toBeVisible({ timeout: 10_000 });
      } else {
        expect(disabled).toBeTruthy();
      }
    }

    // Cleanup: store marks ready → driver completes so the queue is clean
    await ready(store).click();
    await expect(pickup(driver)).toBeEnabled({ timeout: 15_000 });
    await pickup(driver).click();
    await deliver(driver).click();
  });

  test('conflict: customer cannot cancel after store accepts', async () => {
    const orderId = await placeOrder(customer);
    await waitForOrderCard(store, orderId);
    await accept(store).click();

    await customer.goto(`/order-tracking/${orderId}`);
    const cancelBtn = cancel(customer);
    if (await cancelBtn.isVisible().catch(() => false)) {
      const disabled = await cancelBtn.isDisabled();
      if (!disabled) {
        await cancelBtn.click();
        // Either a confirm step refuses, or a toast explains
        await expect(
          customer.getByText(/δεν.*ακυρ|cannot.*cancel|too.?late/i).first(),
        ).toBeVisible({ timeout: 10_000 });
      } else {
        expect(disabled).toBeTruthy();
      }
    }

    // Cleanup
    await ready(store).click();
    await waitForOrderCard(driver, orderId);
    await accept(driver).click();
    await pickup(driver).click();
    await deliver(driver).click();
  });

  test('conflict: driver cannot deliver an order they have not picked up', async () => {
    const orderId = await placeOrder(customer);
    await waitForOrderCard(store, orderId);
    await accept(store).click();
    await ready(store).click();

    await waitForOrderCard(driver, orderId);
    await accept(driver).click();

    const deliverBtn = deliver(driver);
    // Before pickup, deliver must not be reachable
    if (await deliverBtn.isVisible().catch(() => false)) {
      expect(await deliverBtn.isDisabled()).toBeTruthy();
    } else {
      // Action is hidden until pickup — that's the expected guard
      expect(await deliverBtn.count()).toBe(0);
    }

    // Now pick up and complete normally
    await pickup(driver).click();
    await expect(deliver(driver)).toBeEnabled({ timeout: 15_000 });
    await deliver(driver).click();
    await expect(customer.getByText(/παραδόθηκε|delivered/i).first())
      .toBeVisible({ timeout: 20_000 });
  });

  test('conflict: delivered order cannot be delivered again', async () => {
    const orderId = await placeOrder(customer);
    await waitForOrderCard(store, orderId);
    await accept(store).click();
    await ready(store).click();
    await waitForOrderCard(driver, orderId);
    await accept(driver).click();
    await pickup(driver).click();
    await deliver(driver).click();
    await expect(customer.getByText(/παραδόθηκε|delivered/i).first())
      .toBeVisible({ timeout: 20_000 });

    // The deliver button must be gone (order left the active queue).
    await expect(async () => {
      expect(await deliver(driver).count()).toBe(0);
    }).toPass({ timeout: 15_000 });
  });
});
