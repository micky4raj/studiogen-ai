import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import crypto from "crypto";
import { getSupabaseServiceClient } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get("x-razorpay-signature")!;

  const expectedSignature = crypto
    .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET!)
    .update(body)
    .digest("hex");

  if (expectedSignature !== signature) {
    logger.error("Razorpay webhook signature mismatch", undefined, { headerPresent: !!signature });
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const event = JSON.parse(body);
  const supabase = getSupabaseServiceClient();

  if (event.event !== "payment.captured") {
    // Nothing to do for other event types (payment.failed, order.paid, etc.) —
    // ack with 200 so Razorpay doesn't retry, without touching the dedupe table.
    return NextResponse.json({ received: true });
  }

  const payment = event.payload.payment.entity;
  const notes = payment.notes || {};
  const userId = notes.userId;
  const credits = Number(notes.credits || 0);

  if (!userId || credits <= 0) {
    return NextResponse.json({ received: true });
  }

  // payment.entity.id is stable across Razorpay's retries of the same delivery,
  // unlike falling back to the generic event name (which would falsely collide
  // across different payments and never actually reach this branch).
  const { error } = await supabase.rpc("record_and_credit_webhook_event", {
    p_provider: "razorpay",
    p_event_id: payment.id,
    p_user_id: userId,
    p_amount: credits,
    p_reason: "purchase",
  });

  if (error) {
    logger.error("Razorpay credit RPC failed", error, { userId, paymentId: payment.id });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
