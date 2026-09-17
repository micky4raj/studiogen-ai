import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const hasUpstash = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);

/**
 * In-memory fallback so local dev works without an Upstash account.
 * NOT safe for multi-instance/serverless production — each instance has its
 * own counters, so a determined caller could get N requests per instance.
 * Set UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN before deploying.
 */
class InMemoryRatelimit {
  private hits = new Map<string, { count: number; resetAt: number }>();
  constructor(private limit: number, private windowMs: number) {}

  async limitCheck(key: string) {
    const now = Date.now();
    const entry = this.hits.get(key);

    if (!entry || now > entry.resetAt) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return { success: true, remaining: this.limit - 1 };
    }

    if (entry.count >= this.limit) {
      return { success: false, remaining: 0 };
    }

    entry.count += 1;
    return { success: true, remaining: this.limit - entry.count };
  }
}

// Exported for unit testing (lib/__tests__/rate-limit.test.ts) — lets tests
// exercise the limiter with small custom limits/windows instead of waiting
// on the real 1-hour production windows used by generationRateLimit below.
export { InMemoryRatelimit };

export function buildLimiter(limit: number, window: `${number} ${"s" | "m" | "h"}`) {
  if (hasUpstash) {
    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
    return new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(limit, window) });
  }

  const windowMs =
    { s: 1000, m: 60_000, h: 3_600_000 }[window.split(" ")[1] as "s" | "m" | "h"] *
    Number(window.split(" ")[0]);
  const fallback = new InMemoryRatelimit(limit, windowMs);
  return { limit: (key: string) => fallback.limitCheck(key) };
}

// Image + copy generation hit paid Claude/Replicate APIs — keep these tight per user.
export const generationRateLimit = buildLimiter(10, "1 h");

// Checkout session / order creation — cheap, but still worth capping against abuse.
export const checkoutRateLimit = buildLimiter(20, "1 h");

export async function checkRateLimit(
  limiter: ReturnType<typeof buildLimiter>,
  identifier: string
): Promise<{ success: boolean; remaining: number }> {
  const result = await limiter.limit(identifier);
  return { success: result.success, remaining: (result as any).remaining ?? 0 };
}
