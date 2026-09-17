import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { requireUser, UnauthorizedError } from "@/lib/auth";
import { generateProductCopy } from "@/lib/anthropic";
import { copywritingSchema, parseOrError } from "@/lib/validation";
import { generationRateLimit, checkRateLimit } from "@/lib/rate-limit";

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
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const { data, error } = parseOrError(copywritingSchema, body);
  if (error) return NextResponse.json({ error }, { status: 400 });

  try {
    const copy = await generateProductCopy(data);
    return NextResponse.json({ copy });
  } catch (err) {
    logger.error("Copywriting generation failed", err, { userId: user.id });
    return NextResponse.json({ error: "Failed to generate product copy" }, { status: 500 });
  }
}
