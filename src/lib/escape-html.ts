/**
 * Escape a string for safe interpolation into innerHTML / setHTML.
 * Use this for ANY value sourced from the database or user input
 * before splicing it into a Mapbox popup or other HTML template.
 */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Returns the URL only if it is a safe https:// URL. Otherwise returns
 * an empty string. Use before putting a user-supplied URL into an
 * `src` / `href` attribute inside an innerHTML template.
 */
export function safeHttpsUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  try {
    const u = new URL(value);
    if (u.protocol === 'https:' || u.protocol === 'http:') {
      return escapeHtml(u.toString());
    }
  } catch {
    /* not a URL */
  }
  return '';
}
