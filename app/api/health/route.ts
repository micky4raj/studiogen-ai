import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase";

/**
 * GET /api/health — for uptime monitors (UptimeRobot, Vercel's own checks, etc).
 *
 * Checks Postgres reachability since that's fast and free. Deliberately does
 * NOT ping Anthropic/Replicate/Cloudinary here — those cost money per call
 * and a monitor hitting this endpoint every minute would rack up real spend
 * for zero benefit; if the DB is up and env vars are present, that's a
 * reasonable proxy for "the app can serve requests."
 */
export async function GET() {
  try {
    const supabase = getSupabaseServiceClient();
    const { error } = await supabase.from("user_credits").select("user_id").limit(1);

    if (error) {
      return NextResponse.json({ status: "degraded", db: "unreachable" }, { status: 503 });
    }

    return NextResponse.json({ status: "ok", db: "reachable" });
  } catch (err) {
    return NextResponse.json({ status: "down" }, { status: 503 });
  }
}
