import { describe, it, expect } from "vitest";
import { CREDIT_PACKS, SUBSCRIPTION_PLANS } from "@/lib/credits";
import { CREDIT_COST_PER_IMAGE_BATCH } from "@/types";

describe("CREDIT_PACKS", () => {
  it.each(Object.entries(CREDIT_PACKS))("%s has a positive credit amount and price", (_name, pack) => {
    expect(pack.credits).toBeGreaterThan(0);
    expect(pack.priceUsd).toBeGreaterThan(0);
  });

  it("larger packs offer a better or equal per-credit price (sanity, not a hard business rule)", () => {
    const entries = Object.values(CREDIT_PACKS).sort((a, b) => a.credits - b.credits);
    for (let i = 1; i < entries.length; i++) {
      const prevPerCredit = entries[i - 1].priceUsd / entries[i - 1].credits;
      const currPerCredit = entries[i].priceUsd / entries[i].credits;
      expect(currPerCredit).toBeLessThanOrEqual(prevPerCredit);
    }
  });
});

describe("SUBSCRIPTION_PLANS", () => {
  it.each(Object.entries(SUBSCRIPTION_PLANS))(
    "%s has a positive monthly credit grant and price",
    (_name, plan) => {
      expect(plan.creditsPerMonth).toBeGreaterThan(0);
      expect(plan.priceUsd).toBeGreaterThan(0);
    }
  );
});

describe("CREDIT_COST_PER_IMAGE_BATCH", () => {
  it("is a positive integer (used directly as a Postgres RPC amount)", () => {
    expect(Number.isInteger(CREDIT_COST_PER_IMAGE_BATCH)).toBe(true);
    expect(CREDIT_COST_PER_IMAGE_BATCH).toBeGreaterThan(0);
  });
});
