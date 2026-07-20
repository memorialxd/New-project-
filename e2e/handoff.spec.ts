import { test, expect, BrowserContext } from '@playwright/test';
import { loginAs, users } from './helpers/auth';
import { placeOrder, waitForOrderCard } from './helpers/order';

test.describe('Customer → Store → Driver handoff', () => {
  let customerCtx: BrowserContext;
  let storeCtx: BrowserContext;
  let driverCtx: BrowserContext;

  test.beforeAll(async ({ browser }) => {
    customerCtx = await browser.newContext();
    storeCtx = await browser.newContext();
    driverCtx = await browser.newContext();
  });

  test.afterAll(async () => {
    await customerCtx.close();
    await storeCtx.close();
    await driverCtx.close();
  });

  test('happy path: place → accept → ready → assign → pickup → deliver', async () => {
    const customer = await loginAs(customerCtx, users.customer);
    const store = await loginAs(storeCtx, users.store);
    const driver = await loginAs(driverCtx, users.driver);

    // 1. Customer places order
    const orderId = await placeOrder(customer);

    // 2. Store sees it in real-time (no refresh) and accepts
    await waitForOrderCard(store, orderId);
    await store.getByRole('button', { name: /αποδοχή|accept/i }).first().click();

    // 3. Store marks ready — this is the server-side pickup gate
    await store.getByRole('button', { name: /έτοιμη|ready/i }).first().click();

    // 4. Driver sees the offer and accepts (soft reservation)
    await waitForOrderCard(driver, orderId);
    await driver.getByRole('button', { name: /αποδοχή|accept/i }).first().click();

    // 5. Driver picks up (only allowed because store marked ready)
    await driver.getByRole('button', { name: /παραλαβή|pick.?up/i }).first().click();

    // 6. Driver completes delivery
    await driver.getByRole('button', { name: /παράδοση|deliver|complete/i }).first().click();

    // 7. Customer order tracking reflects "delivered" via realtime
    await customer.goto(`/orders/${orderId}`);
    await expect(customer.getByText(/παραδόθηκε|delivered/i)).toBeVisible({ timeout: 20_000 });
  });

  test('cancel flow: customer cancels before store accepts', async () => {
    const customer = await loginAs(customerCtx, users.customer);
    const store = await loginAs(storeCtx, users.store);

    const orderId = await placeOrder(customer);
    await waitForOrderCard(store, orderId);

    // Customer cancels
    await customer.goto(`/orders/${orderId}`);
    await customer.getByRole('button', { name: /ακύρωση|cancel/i }).first().click();
    await customer.getByRole('button', { name: /επιβεβαίωση|confirm/i }).first().click();

    // Customer view shows cancelled
    await expect(customer.getByText(/ακυρώθηκε|cancelled/i)).toBeVisible();

    // Store view: order disappears from active or shows cancelled (realtime)
    await expect(async () => {
      await store.reload(); // belt-and-braces in case realtime subscription hiccups
      const cancelled = store.getByText(/ακυρώθηκε|cancelled/i);
      const gone = store.getByText(orderId.slice(0, 8));
      const cancelledCount = await cancelled.count();
      const goneCount = await gone.count();
      expect(cancelledCount > 0 || goneCount === 0).toBeTruthy();
    }).toPass({ timeout: 30_000 });
  });

  test('conflict: two drivers race to accept; only one wins', async ({ browser }) => {
    const customer = await loginAs(customerCtx, users.customer);
    const store = await loginAs(storeCtx, users.store);
    const driver1 = await loginAs(driverCtx, users.driver);
    const driver2Ctx = await browser.newContext();
    const driver2 = await loginAs(driver2Ctx, users.driver2);

    const orderId = await placeOrder(customer);
    await waitForOrderCard(store, orderId);
    await store.getByRole('button', { name: /αποδοχή|accept/i }).first().click();
    await store.getByRole('button', { name: /έτοιμη|ready/i }).first().click();

    await Promise.all([
      waitForOrderCard(driver1, orderId),
      waitForOrderCard(driver2, orderId),
    ]);

    // Both press Accept at (almost) the same time
    const accept1 = driver1.getByRole('button', { name: /αποδοχή|accept/i }).first().click();
    const accept2 = driver2.getByRole('button', { name: /αποδοχή|accept/i }).first().click();
    const results = await Promise.allSettled([accept1, accept2]);
    expect(results.some((r) => r.status === 'fulfilled')).toBeTruthy();

    // Exactly one driver should now own the order; the other should see
    // the offer disappear or get an error toast.
    const driver1Owns = await driver1
      .getByRole('button', { name: /παραλαβή|pick.?up/i })
      .first()
      .isVisible()
      .catch(() => false);
    const driver2Owns = await driver2
      .getByRole('button', { name: /παραλαβή|pick.?up/i })
      .first()
      .isVisible()
      .catch(() => false);

    expect(Number(driver1Owns) + Number(driver2Owns)).toBe(1);

    await driver2Ctx.close();
  });
});
