/**
 * Shortens a full address by removing repeated/redundant parts.
 * e.g. "Λεωφόρος Δωδώνης 45, Ιωάννινα, Ιωάννινα, Ελλάδα" → "Λεωφόρος Δωδώνης 45, Ιωάννινα"
 */
export function shortenAddress(address: string | null | undefined): string {
  if (!address) return '';
  
  // Split by comma and trim each part
  const parts = address.split(',').map(p => p.trim()).filter(Boolean);
  
  if (parts.length <= 1) return address;

  // Remove duplicate consecutive parts (case-insensitive)
  const unique: string[] = [];
  for (const part of parts) {
    const lower = part.toLowerCase();
    // Skip if same as previous, or if it's a country name we want to drop
    if (unique.length > 0 && unique[unique.length - 1].toLowerCase() === lower) continue;
    unique.push(part);
  }

  // Remove common country suffixes to keep it short
  const countriesToRemove = ['ελλάδα', 'greece', 'ελλάς'];
  const filtered = unique.filter(p => !countriesToRemove.includes(p.toLowerCase()));

  // Keep max 3 parts: street, area, city
  return filtered.slice(0, 3).join(', ');
}
