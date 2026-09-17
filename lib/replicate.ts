import Replicate from "replicate";
import type { GeneratedImage } from "@/types";
import { removeBackgroundWithCloudinary } from "@/lib/cloudinary";

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

// Stability AI's inpainting model takes `image` + `mask` — the correct pairing
// for "keep the product exactly, regenerate everything else". A plain
// text/img2img model like Flux 1.1 Pro has no mask input and can redraw the
// product itself, which is why this pipeline uses a masked inpainting model.
const MODEL_VERSION =
  process.env.REPLICATE_MODEL_VERSION || "stability-ai/stable-diffusion-inpainting";

/**
 * Generates one studio-quality image. `flattenedImageUrl` and `maskUrl` come
 * from lib/mask.ts:prepareInpaintingInputs — the mask constrains generation
 * to the background only, preserving the product pixel-for-pixel.
 */
export async function generateStudioImage(
  flattenedImageUrl: string,
  maskUrl: string,
  prompt: string
): Promise<{ predictionId: string; outputUrl: string }> {
  const prediction = await replicate.run(MODEL_VERSION as `${string}/${string}`, {
    input: {
      image: flattenedImageUrl,
      mask: maskUrl,
      prompt: `${prompt}, commercial product photography, 4k, studio lighting, high detail`,
      negative_prompt: "blurry, low quality, watermark, text, distorted product, extra objects",
      num_inference_steps: 30,
      guidance_scale: 7.5,
    },
  });

  const outputUrl = Array.isArray(prediction) ? prediction[0] : (prediction as unknown as string);

  return {
    predictionId: (prediction as any)?.id ?? crypto.randomUUID(),
    outputUrl,
  };
}

/**
 * Runs 4 parallel generations (one per prompt from Claude) for a single batch,
 * all using the same flattened image + mask pair.
 */
export async function generateStudioImageBatch(
  flattenedImageUrl: string,
  maskUrl: string,
  prompts: string[]
): Promise<GeneratedImage[]> {
  if (prompts.length !== 4) {
    throw new Error("Expected exactly 4 prompts for a generation batch");
  }

  const results = await Promise.all(
    prompts.map(async (prompt) => {
      const { predictionId, outputUrl } = await generateStudioImage(
        flattenedImageUrl,
        maskUrl,
        prompt
      );
      return {
        id: crypto.randomUUID(),
        url: outputUrl, // caller re-uploads this to Supabase Storage for permanence
        replicatePredictionId: predictionId,
        prompt,
      };
    })
  );

  return results;
}

/**
 * Background removal. Swap implementation based on BG_REMOVAL_PROVIDER env var.
 */
export async function removeBackground(imageUrl: string): Promise<string> {
  const provider = process.env.BG_REMOVAL_PROVIDER || "cloudinary";

  if (provider === "rembg") {
    const res = await fetch(process.env.REMBG_ENDPOINT!, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_url: imageUrl }),
    });
    if (!res.ok) throw new Error("rembg background removal failed");
    const { output_url } = await res.json();
    return output_url;
  }

  return removeBackgroundWithCloudinary(imageUrl);
}
