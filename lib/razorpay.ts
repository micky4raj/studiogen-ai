import Razorpay from "razorpay";
import { CREDIT_PACKS } from "@/lib/credits";
import type { CreditPack } from "@/types";

export const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID!,
  key_secret: process.env.RAZORPAY_KEY_SECRET!,
});

// Reference USD->INR rate, overridable via env so it doesn't silently go
// stale in code — still a static rate rather than a live FX feed. For real
// INR pricing, prefer setting INR amounts directly per pack via
// RAZORPAY_PRICE_<PACK>_INR below, which takes precedence when set.
const USD_TO_INR = Number(process.env.RAZORPAY_USD_TO_INR_RATE) || 87;

/**
 * Creates a Razorpay Order for a credit pack. The client then opens Razorpay's
 * Checkout widget with this order_id (see components/razorpay-button.tsx).
 * Unlike Stripe Checkout, Razorpay has no hosted redirect URL — the order is
 * confirmed client-side via the Checkout modal, then verified server-side
 * in /api/webhooks/razorpay.
 */
export async function createCreditPackOrder(userId: string, pack: CreditPack) {
  const { credits, priceUsd } = CREDIT_PACKS[pack];

  const explicitInrPrice = Number(process.env[`RAZORPAY_PRICE_${pack.toUpperCase()}_INR`]);
  const priceInr = explicitInrPrice > 0 ? explicitInrPrice : priceUsd * USD_TO_INR;
  const amountInPaise = Math.round(priceInr * 100);

  const order = await razorpay.orders.create({
    amount: amountInPaise,
    currency: "INR",
    receipt: `${userId}_${pack}_${Date.now()}`,
    notes: { userId, pack, credits: String(credits) },
  });

  return order;
}
