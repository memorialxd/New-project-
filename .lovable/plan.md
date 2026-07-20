# Smart Stacked Routing (up to 3 orders)

Today drivers can only carry **one** order at a time. The codebase has a half-built 1+1 "stacked" link but nothing supports 2 or 3 active orders, and dispatch hard-excludes any driver already on a job. This plan turns that into a real multi-order batch system with optimized stop ordering.

## What changes for the driver

- A driver can hold up to **3 active orders** simultaneously (configurable from Admin → Money Engine settings, default 3).
- After accepting an order, the dispatcher may offer a 2nd/3rd order **only if it is on the way** (same store or close pickup, and the new dropoff doesn't add more than X minutes of detour).
- The driver app shows a **multi-stop route card**: a clean ordered list of remaining stops (Pickup A → Pickup B → Dropoff B → Dropoff A) with the next stop highlighted and ETA per stop.
- The map draws the full sequence with numbered pins; navigation always points to the next stop.
- "Smart route" = nearest-neighbor optimization across remaining pickups and dropoffs, with a hard rule that a dropoff can only happen after its pickup.

## What changes for the customer

- No visible change; their ETA is recomputed using the driver's actual stop sequence so it stays accurate when their order is batched.

## What changes for the admin

- New setting in Money Engine → Dispatch: **Max stacked orders per driver** (1–3) + **Max detour minutes** for a stack offer to be considered "on the way".
- New badge on the order list when an order is part of a batch.

## Technical scope

**Database**
- Add `batch_id uuid` and `stop_sequence int` to `orders`. Keep `stacked_with_order_id` for backward read compatibility, fill from `batch_id`.
- Add `max_stacked_orders int default 3` and `stack_max_detour_minutes int default 8` to `platform_settings`.
- Rewrite `nearby_active_drivers` RPC: instead of excluding any driver with an active order, allow drivers whose active-order count `< max_stacked_orders`, and (for stack candidates) score by detour distance from their current route.

**Auto-dispatch (`supabase/functions/auto-dispatch`)**
- Two-phase offer: (1) fresh drivers (0 active); (2) stack candidates (1–2 active) ranked by detour cost. Assign `batch_id` of the existing order to the new offer at acceptance time.

**Accept-offer (`supabase/functions/accept-offer`)**
- On accept, if driver already has active orders → reuse their `batch_id` (create one if null), set `stop_sequence` after running the route optimizer.

**New edge function `optimize-route`**
- Input: driver location + list of remaining stops (each with type pickup/dropoff, coords, paired order id).
- Output: ordered sequence honoring pickup-before-dropoff, minimizing total distance (greedy nearest-neighbor with the constraint; good enough for ≤6 stops).
- Called by `accept-offer` and whenever a stop completes.

**Client**
- `useOrders.ts`: return `activeDeliveries` (array) and `currentBatch` instead of single `activeDelivery`. Keep a `currentStop` derived from `stop_sequence`.
- `ActiveDelivery.tsx`: redesign into a stacked card showing the ordered stop list, with the current stop expanded and the rest collapsed.
- `NavigationPanel.tsx` + `DriverMapbox.tsx`: draw multi-waypoint polyline, numbered markers, focus on next stop.
- `StackedOrderBanner.tsx`: iterate over batch members (not just one partner).
- Admin settings panel: two new inputs wired to `platform_settings`.

## Out of scope

- Cross-store batching beyond the detour rule (no "pick up at restaurant A then B in two different neighborhoods just because they fit 3").
- Customer-facing batch transparency / live multi-stop ETA visualization.
- Reordering stops manually by the driver (auto-optimized only in v1).

## Rollout

1. Migration (schema + RPC + settings) — gated behind `max_stacked_orders = 1` so behavior is unchanged on deploy.
2. Backend functions (`accept-offer`, `auto-dispatch`, `optimize-route`).
3. Driver UI refactor.
4. Admin toggle to raise `max_stacked_orders` to 3 when ready.
