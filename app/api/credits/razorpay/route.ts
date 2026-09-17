import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { requireUser, UnauthorizedError } from "@/lib/auth";
import { createCreditPackOrder } from "@/lib/razorpay";
import { creditPackSchema, parseOrError } from "@/lib/validation";
import { checkoutRateLimit, checkRateLimit } from "@/lib/rate-limit";

// POST /api/credits/razorpay — { pack }
// Identity from session, matching /api/credits (Stripe path).
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

  const { success } = await checkRateLimit(checkoutRateLimit, user.id);
  if (!success) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const body = await req.json().catch(() => null);
  const { data, error } = parseOrError(creditPackSchema, body);
  if (error) return NextResponse.json({ error }, { status: 400 });

  try {
    const order = await createCreditPackOrder(user.id, data.pack);
    return NextResponse.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    logger.error("Failed to create Razorpay order", err, { userId: user.id, pack: data.pack });
    return NextResponse.json({ error: "Failed to create Razorpay order" }, { status: 500 });
  }
}
