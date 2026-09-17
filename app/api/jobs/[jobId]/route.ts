import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient, requireUser, UnauthorizedError } from "@/lib/auth";
import type { ImageGenerationJob } from "@/types";

/**
 * The generation_jobs table uses snake_case columns (Postgres convention);
 * the ImageGenerationJob type uses camelCase (TS/JS convention). Returning
 * the raw row was working by coincidence — every field the frontend actually
 * reads (status, niche, results, error, id) happens to be a single word where
 * both cases are identical. Any use of e.g. `job.backgroundRemovedUrl` or
 * `job.createdAt` would have silently been `undefined`. Mapping explicitly here.
 */
function mapJobRow(row: any): ImageGenerationJob {
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status,
    originalImageUrl: row.original_image_url,
    backgroundRemovedUrl: row.background_removed_url ?? undefined,
    niche: row.niche,
    prompts: row.prompts ?? undefined,
    results: row.results ?? undefined,
    creditsCharged: row.credits_charged,
    createdAt: row.created_at,
    error: row.error ?? undefined,
  };
}

/**
 * GET /api/jobs/:jobId
 * Uses the RLS-scoped server client (not the service-role client) so a user
 * can only ever read their own job rows — enforced by the "Users can view own
 * jobs" policy in supabase/schema.sql, not just by application logic.
 */
export async function GET(req: NextRequest, { params }: { params: { jobId: string } }) {
  try {
    await requireUser();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    throw err;
  }

  const supabase = getSupabaseServerClient();
  const { data: row, error } = await supabase
    .from("generation_jobs")
    .select("*")
    .eq("id", params.jobId)
    .single();

  if (error || !row) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ job: mapJobRow(row) });
}
