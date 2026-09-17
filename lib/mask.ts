import sharp from "sharp";
import { uploadImageToStorage } from "@/lib/supabase";

/**
 * Diffusion inpainting models expect two inputs: a flat RGB image, and a mask
 * where white = "regenerate this area" and black = "keep this area exactly".
 *
 * A background-removed PNG only gives us transparency — it doesn't tell an
 * inpainting model anything on its own. Feeding it directly as `image` (as an
 * earlier version of this pipeline did) risks the model altering or redrawing
 * the product itself, since there's no mask constraining it to the background.
 *
 * Pulled out from prepareInpaintingInputs as a pure buffer-in/buffer-out
 * function (no network fetch, no Supabase upload) specifically so this — the
 * actual correctness-critical transformation — is unit-testable in isolation.
 * See lib/__tests__/mask.test.ts.
 */
export async function deriveInpaintingBuffers(
  inputBuffer: Buffer
): Promise<{ flattenedBuffer: Buffer; maskBuffer: Buffer }> {
  const image = sharp(inputBuffer).ensureAlpha();

  const [flattenedBuffer, maskBuffer] = await Promise.all([
    image.clone().flatten({ background: "#ffffff" }).png().toBuffer(),
    image
      .clone()
      .extractChannel("alpha") // 255 where product is, 0 where background was removed
      .negate() // invert -> 255 (white) where background should be regenerated
      .png()
      .toBuffer(),
  ]);

  return { flattenedBuffer, maskBuffer };
}

/**
 * Fetches the background-removed image, derives the flattened image + mask,
 * and uploads both to Storage. This is the I/O shell around deriveInpaintingBuffers.
 * - flattenedUrl: the transparent PNG composited onto white (a valid RGB input)
 * - maskUrl: alpha channel inverted, so transparent (removed) areas -> white
 *   (inpaint) and opaque (product) areas -> black (preserve)
 */
export async function prepareInpaintingInputs(
  backgroundRemovedImageUrl: string,
  userId: string,
  jobId: string
): Promise<{ flattenedUrl: string; maskUrl: string }> {
  const res = await fetch(backgroundRemovedImageUrl);
  if (!res.ok) throw new Error("Failed to fetch background-removed image for mask generation");
  const inputBuffer = Buffer.from(await res.arrayBuffer());

  const { flattenedBuffer, maskBuffer } = await deriveInpaintingBuffers(inputBuffer);

  const [flattenedUrl, maskUrl] = await Promise.all([
    uploadImageToStorage(`${userId}/${jobId}/flattened.png`, flattenedBuffer),
    uploadImageToStorage(`${userId}/${jobId}/mask.png`, maskBuffer),
  ]);

  return { flattenedUrl, maskUrl };
}
