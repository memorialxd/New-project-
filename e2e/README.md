# End-to-end handoff tests

Playwright tests that simulate a real Customer → Store → Driver order lifecycle
against a running preview, including **cancel** and **accept-conflict** scenarios.

## Setup (one-time)

1. Install browsers:
   ```bash
   bunx playwright install chromium
   ```

2. Seed four test accounts in Lovable Cloud and note their credentials:
   - 1 customer
   - 1 store owner who owns at least one published store with one available menu item
   - 2 active drivers (`driver_profiles.is_active = true`)

3. Copy the store's UUID from the database.

4. Create `.env.e2e` (do **not** commit):

   ```bash
   E2E_BASE_URL=https://<your-preview-or-published-url>
   E2E_STORE_ID=<uuid>

   E2E_CUSTOMER_EMAIL=customer@test.local
   E2E_CUSTOMER_PASSWORD=...
   E2E_STORE_EMAIL=store@test.local
   E2E_STORE_PASSWORD=...
   E2E_DRIVER_EMAIL=driver1@test.local
   E2E_DRIVER_PASSWORD=...
   E2E_DRIVER2_EMAIL=driver2@test.local
   E2E_DRIVER2_PASSWORD=...
   ```

## Run

```bash
set -a && source .env.e2e && set +a
bunx playwright test
```

Open the HTML report after a run:

```bash
bunx playwright show-report
```

## Scenarios covered

| Spec | What it verifies |
|---|---|
| `happy path` | Order propagates to store realtime → store accept → ready → driver accept → pickup gate opens → delivery → customer tracking shows delivered. |
| `cancel flow` | Customer cancels before store accepts; store UI reflects cancellation. |
| `conflict` | Two drivers race to accept the same offer; exactly one wins, the other is rejected. |

## Notes

- Tests run **serially** (`workers: 1`) because they share live data.
- Selectors use Greek labels (`Αποδοχή`, `Έτοιμη`, etc.) matching the current UI; if labels change, update `e2e/handoff.spec.ts`.
- For more reliable selectors, add `data-testid` attributes to the relevant buttons and switch the spec to `getByTestId`.
