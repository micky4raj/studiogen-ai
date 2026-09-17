import Stripe from "stripe";
import { CREDIT_PACKS, SUBSCRIPTION_PLANS } from "@/lib/credits";
import type { CreditPack, SubscriptionPlan } from "@/types";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-06-20",
});

/**
 * Creates a Stripe Checkout session for a one-time credit pack purchase.
 * For recurring subscriptions, swap `mode: "payment"` -> `mode: "subscription"`
 * and use a Stripe Price ID tied to a recurring product instead of price_data.
 */
export async function createCreditPackCheckout(
  userId: string,
  pack: CreditPack
): Promise<string> {
  const { credits, priceUsd } = CREDIT_PACKS[pack];

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: { name: `StudioGen AI — ${pack} pack (${credits} credits)` },
          unit_amount: priceUsd * 100,
        },
        quantity: 1,
      },
    ],
    metadata: { userId, pack, credits: String(credits) },
    success_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?checkout=success`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?checkout=cancelled`,
  });

  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  return session.url;
}

/**
 * Creates a Stripe Checkout session in subscription mode for a recurring plan.
 * Unlike the one-time credit pack flow, this needs a real recurring Price ID
 * configured in the Stripe dashboard (STRIPE_PRO_PRICE_ID / STRIPE_STUDIO_PRICE_ID) —
 * subscription line items can't use inline `price_data` the way one-time
 * payments can. The monthly credit grant itself happens on `invoice.paid` in
 * the webhook, not here — this only starts the subscription.
 */
export async function createSubscriptionCheckout(
  userId: string,
  plan: SubscriptionPlan
): Promise<string> {
  const { stripePriceId } = SUBSCRIPTION_PLANS[plan];

  if (!stripePriceId) {
    throw new Error(
      `No Stripe Price ID configured for the "${plan}" plan — set STRIPE_${plan.toUpperCase()}_PRICE_ID`
    );
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: stripePriceId, quantity: 1 }],
    metadata: { userId, plan },
    subscription_data: { metadata: { userId, plan } },
    success_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?subscribe=success`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?subscribe=cancelled`,
  });

  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  return session.url;
}
