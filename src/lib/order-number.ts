/**
 * Per-store sequential order number (1..9999). Falls back to a short
 * hex slice of the UUID for legacy orders that don't have one yet.
 */
export function formatOrderNumber(
  order: { store_order_number?: number | null; id?: string | null } | null | undefined,
  opts: { hash?: boolean } = { hash: true }
): string {
  const prefix = opts.hash === false ? '' : '#';
  const n = order?.store_order_number;
  if (n != null && Number.isFinite(n)) {
    return `${prefix}${String(n).padStart(4, '0')}`;
  }
  const id = order?.id;
  if (id) return `${prefix}${id.slice(0, 6).toUpperCase()}`;
  return `${prefix}—`;
}
