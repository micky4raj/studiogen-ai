import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { requireUser, UnauthorizedError } from "@/lib/auth";
import { getCreditBalance } from "@/lib/credits";
import { createCreditPackCheckout } from "@/lib/stripe";
import { creditPackSchema, parseOrError } from "@/lib/validation";
import { checkoutRateLimit, checkRateLimit } from "@/lib/rate-limit";

// GET /api/credits — balance for the signed-in user (no userId param anymore;
// an earlier version let any caller query any user's balance by passing ?userId=).
export async function GET() {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    throw err;
  }

  try {
    const credits = await getCreditBalance(user.id);
    return NextResponse.json({ credits, locked: credits <= 0 });
  } catch (err) {
    logger.error("Failed to fetch credit balance", err, { userId: user.id });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

// POST /api/credits — { pack: "starter" | "growth" | "scale" }
// Creates a Stripe Checkout session for the signed-in user's own account.
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
    const checkoutUrl = await createCreditPackCheckout(user.id, data.pack);
    return NextResponse.json({ checkoutUrl });
  } catch (err) {
    logger.error("Failed to create Stripe checkout session", err, { userId: user.id, pack: data.pack });
    return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 });
  }
}
