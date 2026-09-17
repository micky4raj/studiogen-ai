import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { requireUser, UnauthorizedError } from "@/lib/auth";
import { getSupabaseServiceClient } from "@/lib/supabase";
import { deductCreditsForGeneration, refundCredits, InsufficientCreditsError } from "@/lib/credits";
import { generateImagesSchema, parseOrError } from "@/lib/validation";
import { generationRateLimit, checkRateLimit } from "@/lib/rate-limit";
import { inngest } from "@/lib/inngest/client";

/**
 * POST /api/generate-images
 * Body: { imageUrl: string, niche: string, productDescription?: string }
 *
 * Identity comes from the session cookie (requireUser), never from the body —
 * an earlier version trusted a client-supplied userId, which let any caller
 * charge credits or generate images against someone else's account.
 *
 * Ordering here matters and is deliberate:
 * 1. Create the job row FIRST (status: "queued", no charge yet) — this gives
 *    credit_transactions.job_id something real to reference, and gives us
 *    something to mark "failed" if a later step breaks.
 * 2. Deduct credits, referencing that job. If this fails (insufficient
 *    credits), delete the just-created job row and return 402 — nothing was
 *    ever charged, so there's nothing to refund.
 * 3. Enqueue the Inngest event. If THIS fails (e.g. a network blip to
 *    Inngest), credits have already been charged with no pipeline ever going
 *    to run them — so we refund and mark the job failed here too. An earlier
 *    version of this route deducted credits before creating the job row and
 *    never refunded on a failed insert or failed enqueue, both of which are
 *    silent credit-loss bugs a real user would eventually notice and complain about.
 */
export async function POST(req: NextRequest) {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    throw err;
  }

  const { success } = await checkRateLimit(generationRateLimit, user.id);
  if (!success) {
    return NextResponse.json(
      { error: "rate_limited", message: "Too many generation requests. Try again later." },
      { status: 429 }
    );
  }

  const body = await req.json().catch(() => null);
  const { data, error } = parseOrError(generateImagesSchema, body);
  if (error) return NextResponse.json({ error }, { status: 400 });

  const supabase = getSupabaseServiceClient();
  const jobId = crypto.randomUUID();

  // Step 1: create the job row before any money moves.
  const { error: insertError } = await supabase.from("generation_jobs").insert({
    id: jobId,
    user_id: user.id,
    status: "queued",
    original_image_url: data.imageUrl,
    niche: data.niche,
    credits_charged: 1,
  });

  if (insertError) {
    logger.error("Failed to persist generation job", insertError, { userId: user.id, jobId });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  // Step 2: charge credits against the now-real job.
  try {
    await deductCreditsForGeneration(user.id, jobId);
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      await supabase.from("generation_jobs").delete().eq("id", jobId);
      return NextResponse.json(
        { error: "insufficient_credits", message: "Upgrade to continue generating images." },
        { status: 402 } // triggers the upgrade dialog on the frontend
      );
    }
    logger.error("Credit deduction failed", err, { userId: user.id, jobId });
    await supabase.from("generation_jobs").delete().eq("id", jobId);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  // Step 3: hand off to the background pipeline. If enqueueing itself fails,
  // credits are already spent — refund them and mark the job failed rather
  // than leaving it stuck in "queued" forever with no compensating action.
  try {
    await inngest.send({
      name: "studio-shoot/requested",
      data: {
        jobId,
        userId: user.id,
        imageUrl: data.imageUrl,
        niche: data.niche,
        productDescription: data.productDescription,
      },
    });
  } catch (err) {
    logger.error("Failed to enqueue generation job", err, { userId: user.id, jobId });
    await refundCredits(user.id, jobId);
    await supabase
      .from("generation_jobs")
      .update({ status: "failed", error: "Failed to start generation pipeline." })
      .eq("id", jobId);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  return NextResponse.json({ jobId, status: "queued" }, { status: 202 });
}
