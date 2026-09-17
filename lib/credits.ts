import { getSupabaseServiceClient } from "@/lib/supabase";
import { CREDIT_COST_PER_IMAGE_BATCH } from "@/types";

export class InsufficientCreditsError extends Error {
  constructor() {
    super("Insufficient credits");
    this.name = "InsufficientCreditsError";
  }
}

/**
 * Returns the user's current credit balance. Assumes a `user_credits` table
 * (see supabase/schema.sql) with columns: user_id, credits, plan, updated_at.
 *
 * Distinguishes "no row yet" (PGRST116 — genuinely 0, e.g. the signup trigger
 * hasn't run yet) from an actual database error. Collapsing both into 0 would
 * make a transient Supabase outage look identical to "you're out of credits"
 * and incorrectly lock out a user who still has a balance.
 */
export async function getCreditBalance(userId: string): Promise<number> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("user_credits")
    .select("credits")
    .eq("user_id", userId)
    .single();

  if (error) {
    if (error.code === "PGRST116") return 0; // no row for this user yet
    throw new Error(`Failed to fetch credit balance: ${error.message}`);
  }

  return data?.credits ?? 0;
}

/**
 * Atomically deducts credits for one image-generation batch using the
 * `deduct_credits` Postgres function (see supabase/schema.sql), which does
 * `UPDATE ... WHERE credits >= amount RETURNING` inside a single statement.
 * This prevents the race condition where two concurrent requests both read
 * a balance of 1, both pass the check, and the balance goes negative.
 */
export async function deductCreditsForGeneration(
  userId: string,
  jobId: string
): Promise<void> {
  const supabase = getSupabaseServiceClient();

  const { data, error } = await supabase.rpc("deduct_credits", {
    p_user_id: userId,
    p_amount: CREDIT_COST_PER_IMAGE_BATCH,
    p_job_id: jobId,
  });

  if (error) throw new Error(`Failed to deduct credits: ${error.message}`);

  // The RPC returns false (rather than erroring) when the balance is insufficient,
  // so the caller can distinguish "no credits" from "database error".
  if (data === false) throw new InsufficientCreditsError();
}

/**
 * Refunds credits if a generation job fails after the deduction (e.g. Replicate error).
 * Also atomic via RPC — avoids the same read-then-write race on the way back up.
 */
export async function refundCredits(userId: string, jobId: string): Promise<void> {
  const supabase = getSupabaseServiceClient();

  const { error } = await supabase.rpc("refund_credits", {
    p_user_id: userId,
    p_amount: CREDIT_COST_PER_IMAGE_BATCH,
    p_job_id: jobId,
  });

  if (error) throw new Error(`Failed to refund credits: ${error.message}`);
}

/**
 * Credit pack definitions for the pay-as-you-go Stripe/Razorpay checkout.
 */
export const CREDIT_PACKS = {
  starter: { credits: 20, priceUsd: 9 },
  growth: { credits: 100, priceUsd: 35 },
  scale: { credits: 500, priceUsd: 149 },
} as const;

/**
 * Recurring subscription tiers — grant `creditsPerMonth` on each successful
 * renewal (Stripe `invoice.paid`), separate from one-time pack purchases.
 * Requires a real Stripe Price ID per tier (recurring, not one-time) — see
 * lib/stripe.ts:createSubscriptionCheckout.
 */
export const SUBSCRIPTION_PLANS = {
  pro: { creditsPerMonth: 150, priceUsd: 39, stripePriceId: process.env.STRIPE_PRO_PRICE_ID },
  studio: { creditsPerMonth: 600, priceUsd: 129, stripePriceId: process.env.STRIPE_STUDIO_PRICE_ID },
} as const;
