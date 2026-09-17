import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/auth";

// Supabase redirects here after a magic-link click or OAuth provider callback.
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const redirectedFrom = req.nextUrl.searchParams.get("redirectedFrom") || "/dashboard";

  if (code) {
    const supabase = getSupabaseServerClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(new URL(redirectedFrom, req.url));
}
