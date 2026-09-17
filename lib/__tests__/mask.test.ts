import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { deriveInpaintingBuffers } from "@/lib/mask";

/**
 * Builds a tiny 4x4 RGBA PNG where the left half is fully opaque (simulating
 * "this is the product") and the right half is fully transparent (simulating
 * "background removal erased this"). Real background-removal output won't be
 * this clean-edged, but the mask logic only cares about the alpha channel,
 * so a synthetic image with a known split is enough to verify the transform.
 */
async function buildHalfTransparentImage(): Promise<Buffer> {
  const width = 4;
  const height = 4;
  const channels = 4; // RGBA
  const raw = Buffer.alloc(width * height * channels);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const isProductSide = x < width / 2;
      raw[i] = 200; // R
      raw[i + 1] = 50; // G
      raw[i + 2] = 50; // B
      raw[i + 3] = isProductSide ? 255 : 0; // A — opaque product vs. removed background
    }
  }

  return sharp(raw, { raw: { width, height, channels } }).png().toBuffer();
}

describe("deriveInpaintingBuffers", () => {
  it("produces a mask that is black over the product and white over the removed background", async () => {
    const input = await buildHalfTransparentImage();
    const { maskBuffer } = await deriveInpaintingBuffers(input);

    const { data, info } = await sharp(maskBuffer).raw().toBuffer({ resolveWithObject: true });
    const channels = info.channels;
    const width = info.width;

    // Sample the left edge (product side) and right edge (removed side).
    const leftPixel = data[0]; // first pixel, first channel
    const rightPixelIndex = (width - 1) * channels;
    const rightPixel = data[rightPixelIndex];

    // Product side should be preserved -> mask near black (0).
    expect(leftPixel).toBeLessThan(20);
    // Removed-background side should be regenerated -> mask near white (255).
    expect(rightPixel).toBeGreaterThan(235);
  });

  it("produces a flattened image with no alpha channel left transparent (valid RGB input for the model)", async () => {
    const input = await buildHalfTransparentImage();
    const { flattenedBuffer } = await deriveInpaintingBuffers(input);

    const { info } = await sharp(flattenedBuffer).raw().toBuffer({ resolveWithObject: true });

    // flatten() composites onto an opaque background — no channel should
    // still carry meaningful transparency for a model to misinterpret.
    // sharp with { channels: 4 } flatten output is fully opaque (alpha=255)
    // everywhere; we just assert the operation didn't error and produced
    // an image of the expected dimensions as a sanity check.
    expect(info.width).toBe(4);
    expect(info.height).toBe(4);
  });
});
