import { NextRequest, NextResponse } from "next/server";
import { requireUser, UnauthorizedError } from "@/lib/auth";
import { createSubscriptionCheckout } from "@/lib/stripe";
import { logger } from "@/lib/logger";
import { checkoutRateLimit, checkRateLimit } from "@/lib/rate-limit";
import { z } from "zod";
import { parseOrError } from "@/lib/validation";

const subscribeSchema = z.object({ plan: z.enum(["pro", "studio"]) });

// POST /api/subscribe — { plan: "pro" | "studio" }
// Starts a recurring Stripe subscription for the signed-in user. The monthly
// credit grant itself happens on `invoice.paid` in /api/webhooks/stripe, not here.
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
  const { data, error } = parseOrError(subscribeSchema, body);
  if (error) return NextResponse.json({ error }, { status: 400 });

  try {
    const checkoutUrl = await createSubscriptionCheckout(user.id, data.plan);
    return NextResponse.json({ checkoutUrl });
  } catch (err) {
    logger.error("Failed to create subscription checkout", err, { userId: user.id, plan: data.plan });
    return NextResponse.json({ error: "Failed to start subscription" }, { status: 500 });
  }
}
