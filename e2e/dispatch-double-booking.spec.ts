import { test, expect, BrowserContext } from '@playwright/test';
import { loginAs, users } from './helpers/auth';
import { placeOrder, waitForOrderCard } from './helpers/order';

test.describe('Dispatch: No double-booking of drivers', () => {
  let customerCtx: BrowserContext;
  let storeCtx: BrowserContext;
  let driver1Ctx: BrowserContext;
  let driver2Ctx: BrowserContext;

  test.beforeAll(async ({ browser }) => {
    customerCtx = await browser.newContext();
    storeCtx = await browser.newContext();
    driver1Ctx = await browser.newContext();
    driver2Ctx = await browser.newContext();
  });

  test.afterAll(async () => {
    await customerCtx.close();
    await storeCtx.close();
    await driver1Ctx.close();
    await driver2Ctx.close();
  });

  test('driver with active order should NOT receive second order offer', async () => {
    const customer = await loginAs(customerCtx, users.customer);
    const store = await loginAs(storeCtx, users.store);
    const driver1 = await loginAs(driver1Ctx, users.driver);
    const driver2 = await loginAs(driver2Ctx, users.driver2);

    // ========== ORDER 1 ==========
    console.log('📋 Placing Order 1...');
    const order1Id = await placeOrder(customer);
    console.log(`✓ Order 1 created: ${order1Id.slice(0, 8)}`);

    // Store accepts order 1
    await waitForOrderCard(store, order1Id);
    await store.getByRole('button', { name: /αποδοχή|accept/i }).first().click();
    console.log('✓ Store accepted Order 1');

    // Store marks ready
    await store.getByRole('button', { name: /έτοιμη|ready/i }).first().click();
    console.log('✓ Store marked Order 1 ready');

    // Driver 1 accepts order 1 (now has active delivery)
    await waitForOrderCard(driver1, order1Id);
    await driver1.getByRole('button', { name: /αποδοχή|accept/i }).first().click();
    console.log('✓ Driver 1 accepted Order 1 (NOW HAS ACTIVE DELIVERY)');

    // ========== ORDER 2 (THE TEST) ==========
    console.log('\n📋 Placing Order 2 (WHILE DRIVER 1 IS BUSY)...');
    const order2Id = await placeOrder(customer);
    console.log(`✓ Order 2 created: ${order2Id.slice(0, 8)}`);

    // Store accepts order 2
    await waitForOrderCard(store, order2Id);
    await store.getByRole('button', { name: /αποδοχή|accept/i }).first().click();
    console.log('✓ Store accepted Order 2');

    // Store marks ready
    await store.getByRole('button', { name: /έτοιμη|ready/i }).first().click();
    console.log('✓ Store marked Order 2 ready');

    // Wait a moment for dispatch to run (cron fires every 30s)
    console.log('\n⏳ Waiting for dispatch to offer Order 2...');
    await driver1.waitForTimeout(2000);
    await driver2.waitForTimeout(2000);

    // ========== VERIFY ==========
    console.log('\n🔍 VERIFICATION:');

    // Check if Driver 1 sees Order 2
    const driver1SeesOrder2 = await driver1
      .getByText(order2Id.slice(0, 8), { exact: false })
      .isVisible()
      .catch(() => false);

    console.log(`  Driver 1 sees Order 2: ${driver1SeesOrder2}`);

    // Check if Driver 2 sees Order 2
    const driver2SeesOrder2 = await driver2
      .getByText(order2Id.slice(0, 8), { exact: false })
      .isVisible()
      .catch(() => false);

    console.log(`  Driver 2 sees Order 2: ${driver2SeesOrder2}`);

    // ========== ASSERTIONS ==========
    console.log('\n✅ ASSERTIONS:');

    // The fix: Driver 1 should NOT get Order 2 because they have an active delivery
    expect(driver1SeesOrder2).toBe(false);
    console.log('  ✓ Driver 1 correctly does NOT see Order 2 (has active delivery)');

    // Driver 2 should get Order 2 instead (they're available)
    expect(driver2SeesOrder2).toBe(true);
    console.log('  ✓ Driver 2 correctly sees Order 2 (is available)');

    console.log('\n🎉 TEST PASSED: Drivers are not double-booked!');
  });
});
