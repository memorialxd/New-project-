// Simple per-key in-memory token-bucket rate limiter for edge functions.
// Note: edge function instances are short-lived and per-region, so this is
// a "best effort" abuse guard, not a strict global limit. For production-grade
// limits, back this with a Redis/Upstash key.

type Bucket = { tokens: number; updated: number };
const buckets = new Map<string, Bucket>();

interface Options {
  capacity: number;       // max burst
  refillPerMinute: number; // tokens added per minute
}

export function rateLimit(key: string, opts: Options): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  const refillPerMs = opts.refillPerMinute / 60_000;

  let b = buckets.get(key);
  if (!b) {
    b = { tokens: opts.capacity, updated: now };
    buckets.set(key, b);
  } else {
    const elapsed = now - b.updated;
    b.tokens = Math.min(opts.capacity, b.tokens + elapsed * refillPerMs);
    b.updated = now;
  }

  if (b.tokens >= 1) {
    b.tokens -= 1;
    return { allowed: true, retryAfter: 0 };
  }

  const need = 1 - b.tokens;
  const retryAfter = Math.ceil(need / refillPerMs / 1000);
  return { allowed: false, retryAfter };
}

export function rateLimitResponse(retryAfter: number, corsHeaders: Record<string, string>) {
  return new Response(
    JSON.stringify({ error: 'Πολλά αιτήματα. Δοκιμάστε ξανά σε λίγο.', retry_after: retryAfter }),
    {
      status: 429,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Retry-After': String(retryAfter),
      },
    }
  );
}

export function clientKey(req: Request, userId?: string | null) {
  if (userId) return `u:${userId}`;
  const fwd = req.headers.get('x-forwarded-for') ?? '';
  const ip = fwd.split(',')[0].trim() || req.headers.get('cf-connecting-ip') || 'anon';
  return `ip:${ip}`;
}
