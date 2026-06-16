// Generalized in-memory sliding-window rate limiter (per warm instance).
//
// This is a key-agnostic generalization of the per-IP limiter in api/gemini.js:20-49.
// The same implementation limits by IP (a dotted-quad string) OR by bearer token
// (a UUID/opaque string) — the key is just a Map key. State is in-memory per warm
// instance, so it resets on cold start. That is an accepted trade-off for a word game
// (D-02): no Redis/Upstash; the project-wide Gemini 429 ceiling is the durable backstop.
//
// UNGUARDED helper: keeping all rate-limit logic here (not in the Tier-1 voice-guarded
// api/gemini.js) makes it fully unit-testable and keeps the api/gemini.js change to a
// minimal import + call wiring.

// Purge keys with zero fresh hits at most this often, to prevent unbounded Map growth.
const CLEANUP_INTERVAL_MS = 300_000; // 5 minutes

// ── Per-user (bearer-token) cap constants (D-02a-derived; do NOT re-derive) ──
// A single 6-guess themed game fans out to ~10-13 Gemini calls (up to 6 per-guess
// reactions plus hint/emoji/suggestion plus post-game roast plus fun fact plus themed
// setup). A legit multi-game session runs 30-50+ calls. 120/hour sits above 4 back-to-back
// heavy games (~52 calls) with headroom, yet far below sustained automated abuse.
export const USER_RATE_LIMIT_WINDOW_MS = 3_600_000; // 1 hour
export const USER_RATE_LIMIT_MAX = 120; // requests per user per hour

/**
 * Build a sliding-window limiter bound to its own in-memory state.
 *
 * @param {{ windowMs: number, max: number }} opts
 * @returns {(key: string) => boolean} returns true when `key` is over the limit
 *   for the current window (request should be rejected), false otherwise (and the
 *   call is counted toward the window).
 */
export function createSlidingWindowLimiter({ windowMs, max }) {
  const hitsByKey = new Map(); // key → [timestamp, timestamp, ...]
  let lastCleanup = Date.now();

  return function isLimited(key) {
    const now = Date.now();

    // Periodic cleanup: drop keys whose hits have all aged out, to bound memory.
    if (now - lastCleanup > CLEANUP_INTERVAL_MS) {
      for (const [k, hits] of hitsByKey) {
        const fresh = hits.filter((t) => now - t < windowMs);
        if (fresh.length === 0) hitsByKey.delete(k);
        else hitsByKey.set(k, fresh);
      }
      lastCleanup = now;
    }

    const hits = (hitsByKey.get(key) || []).filter((t) => now - t < windowMs);
    if (hits.length >= max) {
      hitsByKey.set(key, hits);
      return true;
    }
    hits.push(now);
    hitsByKey.set(key, hits);
    return false;
  };
}

// Module-level limiter bound to the per-user constants. State is shared across all
// callers within one warm instance so a single token's hits accumulate per request.
const userLimiter = createSlidingWindowLimiter({
  windowMs: USER_RATE_LIMIT_WINDOW_MS,
  max: USER_RATE_LIMIT_MAX,
});

/**
 * Per-user (bearer-token) rate check. Falsy tokens (anonymous / pre-register requests)
 * are never limited here — they degrade to the per-IP limit only and never throw.
 *
 * @param {string | null | undefined} token bearer token identifying the user
 * @returns {boolean} true when this token is over the per-user cap
 */
export function isUserRateLimited(token) {
  if (!token) return false;
  return userLimiter(token);
}

// ── Per-IP flood outer bound (applies to ALL requests, tokened or not) ──
// The bearer token in api/gemini.js is NEVER validated server-side (it is just the
// Authorization header string), so "registered" status can be forged. Without an
// unconditional per-IP bound, a hostile client sends a fresh random token per request:
// it skips the anonymous per-IP limiter AND never accumulates per-user hits — unlimited
// Gemini fan-out from one IP (denial-of-wallet). This outer bound caps that.
//
// Ceilings sit ABOVE the legit inner bounds so real users never feel them:
// - 60/min per IP = 2x the anonymous 30/min cap — headroom for several registered
//   players behind one shared carrier/Wi-Fi IP (the D-02 motivation stays intact).
// - 600/hour per IP = 5 registered users at the full 120/hour per-user cap behind
//   one NAT, all at maximum tilt — and bounds a sustained ≤60/min drip attack.
export const IP_FLOOD_LIMIT_WINDOW_MS = 60_000; // 1 minute
export const IP_FLOOD_LIMIT_MAX = 60; // requests per IP per minute, all requests
export const IP_FLOOD_HOURLY_WINDOW_MS = 3_600_000; // 1 hour
export const IP_FLOOD_HOURLY_MAX = 600; // requests per IP per hour, all requests

const ipFloodMinuteLimiter = createSlidingWindowLimiter({
  windowMs: IP_FLOOD_LIMIT_WINDOW_MS,
  max: IP_FLOOD_LIMIT_MAX,
});
const ipFloodHourlyLimiter = createSlidingWindowLimiter({
  windowMs: IP_FLOOD_HOURLY_WINDOW_MS,
  max: IP_FLOOD_HOURLY_MAX,
});

/**
 * Coarse per-IP outer bound — minute window for bursts, hour window for sustained
 * drips. Short-circuit is deliberate: a request rejected by the minute window does
 * NOT consume hourly budget, so a brief legit burst can't snowball into an hour-long
 * lockout for everyone behind the same NAT.
 *
 * @param {string | null | undefined} ip client IP (falsy never throws, never limits)
 * @returns {boolean} true when this IP is over either flood bound
 */
export function isIpFloodLimited(ip) {
  if (!ip) return false;
  return ipFloodMinuteLimiter(ip) || ipFloodHourlyLimiter(ip);
}

/**
 * Resolve the client IP for rate limiting. On Vercel the trustworthy client IP is
 * `x-vercel-forwarded-for` (set by Vercel's edge; NOT client-spoofable), then `x-real-ip`.
 * The LEFTMOST `x-forwarded-for` value is attacker-controllable, so it is only a
 * last-resort fallback (a spoofed XFF must not let an attacker dodge the per-IP bound).
 * @param {{ headers?: Record<string, unknown>, socket?: { remoteAddress?: string } }} req
 * @returns {string}
 */
export function getClientIp(req) {
  const h = req?.headers || {};
  const first = (v) => (Array.isArray(v) ? v[0] : v);
  const pick = (v) => (typeof first(v) === 'string' ? first(v).split(',')[0].trim() : '');
  return (
    pick(h['x-vercel-forwarded-for'])
    || pick(h['x-real-ip'])
    || pick(h['x-forwarded-for'])
    || req?.socket?.remoteAddress
    || 'unknown'
  );
}
