import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { InMemoryRatelimit } from "@/lib/rate-limit";

describe("InMemoryRatelimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests up to the limit", async () => {
    const limiter = new InMemoryRatelimit(3, 60_000);

    for (let i = 0; i < 3; i++) {
      const result = await limiter.limitCheck("user-a");
      expect(result.success).toBe(true);
    }
  });

  it("blocks the request that exceeds the limit", async () => {
    const limiter = new InMemoryRatelimit(2, 60_000);

    await limiter.limitCheck("user-a");
    await limiter.limitCheck("user-a");
    const third = await limiter.limitCheck("user-a");

    expect(third.success).toBe(false);
    expect(third.remaining).toBe(0);
  });

  it("tracks separate identifiers independently", async () => {
    const limiter = new InMemoryRatelimit(1, 60_000);

    const userA = await limiter.limitCheck("user-a");
    const userB = await limiter.limitCheck("user-b");

    expect(userA.success).toBe(true);
    expect(userB.success).toBe(true); // different key — not affected by user-a's usage
  });

  it("resets once the window elapses", async () => {
    const limiter = new InMemoryRatelimit(1, 1_000);

    const first = await limiter.limitCheck("user-a");
    expect(first.success).toBe(true);

    const blocked = await limiter.limitCheck("user-a");
    expect(blocked.success).toBe(false);

    vi.advanceTimersByTime(1_001);

    const afterReset = await limiter.limitCheck("user-a");
    expect(afterReset.success).toBe(true);
  });

  it("does not reset early — right at the boundary still counts as within the window", async () => {
    const limiter = new InMemoryRatelimit(1, 1_000);

    await limiter.limitCheck("user-a");
    vi.advanceTimersByTime(999);

    const stillBlocked = await limiter.limitCheck("user-a");
    expect(stillBlocked.success).toBe(false);
  });
});
