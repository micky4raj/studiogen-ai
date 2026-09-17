import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { stripe } from "@/lib/stripe";
import { getSupabaseServiceClient } from "@/lib/supabase";
import { SUBSCRIPTION_PLANS } from "@/lib/credits";
import type { SubscriptionPlan } from "@/types";
import Stripe from "stripe";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get("stripe-signature")!;

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    logger.error("Stripe webhook signature verification failed", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const supabase = getSupabaseServiceClient();

  // ---------- One-time credit pack purchase ----------
  // record_and_credit_webhook_event does the dedupe check AND the credit grant
  // in one transaction, so a failure between "marked processed" and "credited"
  // can't happen — a separate insert-then-rpc could lose a payment if the
  // second call failed after the first had already committed.
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;

    if (session.mode === "subscription") {
      // Subscription checkouts don't grant credits here — invoice.paid does,
      // once per billing cycle including the first. This just links the
      // Stripe customer/subscription to the user so invoice.paid can find them.
      const userId = session.metadata?.userId;
      const plan = session.metadata?.plan;
      const customerId =
        typeof session.customer === "string" ? session.customer : session.customer?.id;
      const subscriptionId =
        typeof session.subscription === "string" ? session.subscription : session.subscription?.id;

      if (userId && plan && customerId && subscriptionId) {
        const { error } = await supabase.rpc("link_stripe_subscription", {
          p_user_id: userId,
          p_customer_id: customerId,
          p_subscription_id: subscriptionId,
          p_plan: plan,
        });
        if (error) logger.error("Failed to link Stripe subscription", error, { userId, customerId });
      }

      return NextResponse.json({ received: true });
    }

    // mode === "payment" — one-time credit pack
    const userId = session.metadata?.userId;
    const credits = Number(session.metadata?.credits || 0);

    if (userId && credits > 0) {
      const { error } = await supabase.rpc("record_and_credit_webhook_event", {
        p_provider: "stripe",
        p_event_id: event.id,
        p_user_id: userId,
        p_amount: credits,
        p_reason: "purchase",
      });
      if (error) {
        logger.error("Stripe credit RPC failed", error, { userId, eventId: event.id });
        // Return a 500 so Stripe retries — the event was NOT recorded as
        // processed (the RPC's insert only commits alongside a successful credit).
        return NextResponse.json({ error: "internal_error" }, { status: 500 });
      }
    }
  }

  // ---------- Subscription renewal ----------
  // Fires once per billing cycle, including the very first cycle (shortly
  // after checkout.session.completed). We read userId/plan from the
  // Subscription object's own metadata (set at creation in
  // lib/stripe.ts:createSubscriptionCheckout) rather than looking the user up
  // by stripe_customer_id in our DB — Stripe doesn't guarantee webhook
  // delivery order, so if invoice.paid arrived before checkout.session.completed
  // had a chance to run link_stripe_subscription, a DB lookup would fail and
  // silently lose that cycle's credit grant. Metadata on the Subscription
  // object itself has no such ordering dependency.
  if (event.type === "invoice.paid") {
    const invoice = event.data.object as Stripe.Invoice;
    const subscriptionId =
      typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id;

    if (subscriptionId) {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const userId = subscription.metadata?.userId;
      const plan = subscription.metadata?.plan as SubscriptionPlan | undefined;

      if (userId && plan && plan in SUBSCRIPTION_PLANS) {
        const amount = SUBSCRIPTION_PLANS[plan].creditsPerMonth;
        const { error } = await supabase.rpc("record_and_credit_webhook_event", {
          p_provider: "stripe",
          p_event_id: event.id,
          p_user_id: userId,
          p_amount: amount,
          p_reason: "subscription_renewal",
        });
        if (error) {
          logger.error("Subscription renewal credit RPC failed", error, { userId, eventId: event.id });
          return NextResponse.json({ error: "internal_error" }, { status: 500 });
        }
      } else {
        logger.error("invoice.paid missing userId/plan metadata on subscription", null, {
          subscriptionId,
        });
      }
    }
  }

  // ---------- Subscription cancellation ----------
  if (event.type === "customer.subscription.deleted") {
    const subscription = event.data.object as Stripe.Subscription;
    const customerId =
      typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;

    const { error } = await supabase.rpc("cancel_stripe_subscription", {
      p_customer_id: customerId,
    });
    if (error) logger.error("Failed to cancel Stripe subscription", error, { customerId });
  }

  return NextResponse.json({ received: true });
}
