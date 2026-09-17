import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const supabase = getSupabaseServerClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", req.url));
}
