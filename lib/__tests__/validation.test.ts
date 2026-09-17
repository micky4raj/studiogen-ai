import { describe, it, expect } from "vitest";
import {
  generateImagesSchema,
  copywritingSchema,
  creditPackSchema,
  parseOrError,
} from "@/lib/validation";

describe("generateImagesSchema", () => {
  it("accepts a valid payload", () => {
    const result = parseOrError(generateImagesSchema, {
      imageUrl: "https://example.com/photo.png",
      niche: "Luxury Watch",
    });
    expect(result.error).toBeNull();
    expect(result.data?.niche).toBe("Luxury Watch");
  });

  it("rejects a non-URL imageUrl", () => {
    const result = parseOrError(generateImagesSchema, {
      imageUrl: "not-a-url",
      niche: "Luxury Watch",
    });
    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it("rejects a niche that's too short", () => {
    const result = parseOrError(generateImagesSchema, {
      imageUrl: "https://example.com/photo.png",
      niche: "a",
    });
    expect(result.data).toBeNull();
  });

  it("rejects a missing niche entirely", () => {
    const result = parseOrError(generateImagesSchema, {
      imageUrl: "https://example.com/photo.png",
    });
    expect(result.data).toBeNull();
  });

  it("rejects null/non-object bodies (e.g. unparseable JSON)", () => {
    const result = parseOrError(generateImagesSchema, null);
    expect(result.data).toBeNull();
  });
});

describe("copywritingSchema", () => {
  it("accepts a minimal valid payload", () => {
    const result = parseOrError(copywritingSchema, {
      productName: "Aurora Watch",
      niche: "Luxury Watch",
    });
    expect(result.error).toBeNull();
  });

  it("rejects an invalid tone enum value", () => {
    const result = parseOrError(copywritingSchema, {
      productName: "Aurora Watch",
      niche: "Luxury Watch",
      tone: "aggressive", // not one of the allowed enum values
    });
    expect(result.data).toBeNull();
  });

  it("rejects more than 30 target keywords", () => {
    const result = parseOrError(copywritingSchema, {
      productName: "Aurora Watch",
      niche: "Luxury Watch",
      targetKeywords: Array.from({ length: 31 }, (_, i) => `keyword-${i}`),
    });
    expect(result.data).toBeNull();
  });
});

describe("creditPackSchema", () => {
  it("accepts each real pack name", () => {
    for (const pack of ["starter", "growth", "scale"]) {
      const result = parseOrError(creditPackSchema, { pack });
      expect(result.error).toBeNull();
    }
  });

  it("rejects an unknown pack name", () => {
    const result = parseOrError(creditPackSchema, { pack: "mega" });
    expect(result.data).toBeNull();
  });
});
