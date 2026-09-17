import { inngest } from "@/lib/inngest/client";
import { getSupabaseServiceClient, uploadImageToStorage } from "@/lib/supabase";
import { generateBackgroundPrompts } from "@/lib/anthropic";
import { removeBackground, generateStudioImageBatch } from "@/lib/replicate";
import { prepareInpaintingInputs } from "@/lib/mask";
import { refundCredits } from "@/lib/credits";

export type StudioShootRequestedEvent = {
  name: "studio-shoot/requested";
  data: {
    jobId: string;
    userId: string;
    imageUrl: string;
    niche: string;
    productDescription?: string;
  };
};

async function updateJob(jobId: string, patch: Record<string, unknown>) {
  const supabase = getSupabaseServiceClient();
  await supabase
    .from("generation_jobs")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", jobId);
}

/**
 * Runs the full image pipeline out-of-band from the HTTP request that
 * triggered it. This is what the "Queue System" in the original spec
 * describes — without it, 4 sequential Claude+Replicate calls risk exceeding
 * a serverless function's request timeout.
 *
 * Each `step.run` is individually retried by Inngest on transient failure,
 * and the whole run is visible/debuggable in the Inngest dashboard.
 */
export const generateStudioShoot = inngest.createFunction(
  // Each step.run already gets its own automatic retries for transient
  // failures (network blips, rate limits). Once a step exhausts those and
  // this function's catch block runs — marking the job failed and refunding
  // the credit — retrying the whole function again would just replay the
  // already-completed steps from cache and immediately re-throw. That's pure
  // overhead with no chance of a different outcome, so this stays at 0.
  { id: "generate-studio-shoot", retries: 0 },
  { event: "studio-shoot/requested" },
  async ({ event, step }) => {
    const { jobId, userId, imageUrl, niche, productDescription } = event.data;

    try {
      await step.run("mark-processing", () => updateJob(jobId, { status: "processing" }));

      const backgroundRemovedUrl = await step.run("remove-background", () =>
        removeBackground(imageUrl)
      );
      await step.run("save-bg-removed-url", () =>
        updateJob(jobId, { background_removed_url: backgroundRemovedUrl })
      );

      const prompts = await step.run("generate-prompts", () =>
        generateBackgroundPrompts(niche, productDescription)
      );
      await step.run("save-prompts", () => updateJob(jobId, { prompts }));

      const { flattenedUrl, maskUrl } = await step.run("prepare-inpainting-inputs", () =>
        prepareInpaintingInputs(backgroundRemovedUrl, userId, jobId)
      );

      const rawResults = await step.run("generate-images", () =>
        generateStudioImageBatch(flattenedUrl, maskUrl, prompts)
      );

      const finalResults = await step.run("rehost-results", async () => {
        return Promise.all(
          rawResults.map(async (img, idx) => {
            const res = await fetch(img.url);
            const buffer = Buffer.from(await res.arrayBuffer());
            const storagePath = `${userId}/${jobId}/result-${idx}.png`;
            const permanentUrl = await uploadImageToStorage(storagePath, buffer);
            return { ...img, url: permanentUrl };
          })
        );
      });

      await step.run("mark-completed", () =>
        updateJob(jobId, { status: "completed", results: finalResults })
      );

      return { jobId, status: "completed" };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";

      await step.run("mark-failed", () => updateJob(jobId, { status: "failed", error: message }));
      await step.run("refund-credits", () => refundCredits(userId, jobId));

      // Re-throwing lets Inngest record this as a failed run (visible in its
      // dashboard) rather than silently swallowing the error.
      throw err;
    }
  }
);
