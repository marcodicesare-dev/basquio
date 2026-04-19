import "server-only";

/**
 * Sliding-window in-memory rate limit. Per-user, per-bucket.
 *
 * V1 deliberately keeps this in-process: the team-beta workload is small
 * and the cost of a Vercel-edge backed Redis is not justified yet. V2 should
 * swap this for upstash-ratelimit or similar so limits hold across regions.
 */

type WindowEntry = { count: number; resetAt: number };

const buckets = new Map<string, WindowEntry>();
const MAX_TRACKED_KEYS = 500;

function reapExpired(now: number) {
  if (buckets.size <= MAX_TRACKED_KEYS) return;
  for (const [key, entry] of buckets) {
    if (entry.resetAt <= now) buckets.delete(key);
  }
}

export type RateLimitDecision = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
};

export function consume({
  key,
  limit,
  windowMs,
}: {
  key: string;
  limit: number;
  windowMs: number;
}): RateLimitDecision {
  const now = Date.now();
  reapExpired(now);
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return {
      allowed: true,
      remaining: limit - 1,
      resetAt,
      retryAfterSeconds: 0,
    };
  }
  if (existing.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: existing.resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }
  existing.count += 1;
  return {
    allowed: true,
    remaining: limit - existing.count,
    resetAt: existing.resetAt,
    retryAfterSeconds: 0,
  };
}
