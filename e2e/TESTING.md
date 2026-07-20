# E2E Testing: Dispatch Double-Booking Fix

## Quick Start

### 1. Install Dependencies
```bash
bunx playwright install chromium
```

### 2. Get Test Credentials

You need test accounts in your Supabase. Create these if they don't exist:
- `customer@test.local` (password: any)
- `driver1@test.local` (password: any, must be marked `is_active = true`)
- `driver2@test.local` (password: any, must be marked `is_active = true`)
- `store@test.local` (password: any, must own at least 1 published menu item)

Get your **Store UUID** from the database:
```sql
SELECT id, name FROM stores LIMIT 1;
```

### 3. Create .env.e2e

```bash
cat > .env.e2e << 'EOF'
E2E_BASE_URL=https://mariopietri2-maker-q-hva1.bolt.host
E2E_STORE_ID=<paste-store-uuid-here>
E2E_CUSTOMER_EMAIL=customer@test.local
E2E_CUSTOMER_PASSWORD=your_test_password
E2E_STORE_EMAIL=store@test.local
E2E_STORE_PASSWORD=your_test_password
E2E_DRIVER_EMAIL=driver1@test.local
E2E_DRIVER_PASSWORD=your_test_password
E2E_DRIVER2_EMAIL=driver2@test.local
E2E_DRIVER2_PASSWORD=your_test_password
EOF
```

### 4. Run the Test

**With UI (recommended):**
```bash
set -a && source .env.e2e && set +a
bunx playwright test e2e/dispatch-double-booking.spec.ts --ui
```

**Headless:**
```bash
set -a && source .env.e2e && set +a
bunx playwright test e2e/dispatch-double-booking.spec.ts
```

**Verbose output:**
```bash
set -a && source .env.e2e && set +a
bunx playwright test e2e/dispatch-double-booking.spec.ts -v
```

---

## What This Test Verifies

✅ **Order 1** placed and accepted by Driver 1  
✅ **Driver 1** accepts Order 1 (now has active delivery)  
✅ **Order 2** placed while Driver 1 is busy  
✅ **Dispatch runs** and offers Order 2  
✅ **Driver 1 does NOT see Order 2** ← THE FIX  
✅ **Driver 2 sees Order 2** ← Available driver gets it  

---

## Expected Output (PASS)

```
✓ driver with active order should NOT receive second order offer (45s)
  📋 Placing Order 1...
  ✓ Order 1 created
  ✓ Driver 1 accepted Order 1 (NOW HAS ACTIVE DELIVERY)
  
  📋 Placing Order 2 (WHILE DRIVER 1 IS BUSY)...
  ✓ Order 2 created
  
  🔍 VERIFICATION:
    Driver 1 sees Order 2: false ✓
    Driver 2 sees Order 2: true  ✓
  
  ✓ Driver 1 correctly does NOT see Order 2 (has active delivery)
  ✓ Driver 2 correctly sees Order 2 (is available)
  
  🎉 TEST PASSED: Drivers are not double-booked!
```

---

## Troubleshooting

### Test times out waiting for Order 2
- Check that dispatch cron is enabled: `SELECT auto_dispatch_enabled FROM platform_settings WHERE id = 1;`
- Verify both drivers have GPS data: `SELECT * FROM driver_locations;`

### Driver doesn't see offers
- Ensure driver is marked active: `UPDATE driver_profiles SET is_active = true WHERE user_id = '...';`
- Check driver isn't on break: `SELECT * FROM driver_state;`

### Store can't place orders
- Verify store has published menu: `SELECT * FROM stores WHERE id = '...';`
- Check menu items: `SELECT * FROM menu_items WHERE store_id = '...' AND published = true;`

---

## Notes

- Tests run **serially** (one at a time) because they share live data
- Dispatch runs every 30 seconds (cron), so there's a 2s wait for offers to propagate
- Each test creates real orders in the database; clean up with admin panel if needed
