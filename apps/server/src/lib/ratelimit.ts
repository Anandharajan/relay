/** Fixed-window in-memory rate limiter (swap for Valkey/@upstash/ratelimit when running multiple nodes). */
const windows = new Map<string, { count: number; reset: number }>();

/** Lets a test make more requests than one window allows. */
export function clearRateLimits() {
  windows.clear();
}

export function rateLimit(key: string, limit: number, windowMs: number, consume = true): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  let w = windows.get(key);
  if (!w || w.reset <= now) {
    w = { count: 0, reset: now + windowMs };
    windows.set(key, w);
  }
  if (consume) w.count++;
  if (windows.size > 50_000) {
    for (const [k, v] of windows) if (v.reset <= now) windows.delete(k);
  }
  return { ok: consume ? w.count <= limit : w.count < limit, retryAfter: Math.ceil((w.reset - now) / 1000) };
}
