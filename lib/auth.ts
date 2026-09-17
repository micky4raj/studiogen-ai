import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Server Component / Route Handler client — reads the user's session from cookies.
 * Use this (not lib/supabase.ts's service client) anywhere you need to know
 * "who is the currently signed-in user", respecting RLS.
 */
export function getSupabaseServerClient(): SupabaseClient {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            // Called from a Server Component with no request context — safe to ignore
            // as long as middleware.ts is refreshing the session on every request.
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: "", ...options });
          } catch {
            // see note above
          }
        },
      },
    }
  );
}

/**
 * Fetches the current authenticated user server-side, or null if signed out.
 * Use in Server Components / route handlers to gate access and get a real userId
 * (replaces the MOCK_USER_ID placeholder from the dashboard stub).
 */
export async function getCurrentUser() {
  const supabase = getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/**
 * For API route handlers: returns the authenticated user or throws a typed
 * error the route can catch and turn into a 401. Never trust a `userId` field
 * sent in a request body — always derive identity from the session cookie.
 */
export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  return user;
}
