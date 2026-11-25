import { fail } from "../helpers/http.mjs";
import { clientAddress } from "../helpers/client-ip.mjs";

/** Sliding per-minute request limiter keyed by user id or client IP. */
export function createRateLimiter({ now = Date.now, trustProxy = false, resolveIdentity } = {}) {
  const buckets = new Map();
  return async function rateLimit(req, { anonymousLimit = 120, authenticatedLimit = 300 } = {}) {
    const minute = Math.floor(now() / 60_000);
    const identity = await resolveIdentity?.(req);
    const key = identity ? "user:" + identity.id : "ip:" + clientAddress(req, { trustProxy });
    if (buckets.get(key)?.minute !== minute) {
      for (const [name, value] of buckets) if (value.minute !== minute) buckets.delete(name);
      if (buckets.size >= 4096) fail(429, "Too many requests. Please try again shortly.");
      buckets.set(key, { minute, count: 0 });
    }
    if (++buckets.get(key).count > (identity ? authenticatedLimit : anonymousLimit)) {
      fail(429, "Too many requests. Please try again shortly.");
    }
  };
}
