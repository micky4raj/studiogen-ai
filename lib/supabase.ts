import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Client-side / RLS-scoped client. Safe to use in client components.
 * Respects Row Level Security policies (see supabase/schema.sql).
 */
export function getSupabaseBrowserClient(): SupabaseClient {
  return createClient(supabaseUrl, anonKey);
}

/**
 * Server-only client using the service role key. Bypasses RLS.
 * NEVER import this into a client component or expose the key to the browser.
 * Use only inside app/api/** route handlers or server actions.
 */
export function getSupabaseServiceClient(): SupabaseClient {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

export const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "product-photos";

/**
 * Uploads a buffer (e.g. a Replicate-generated image fetched server-side)
 * into Supabase Storage and returns its public URL.
 */
export async function uploadImageToStorage(
  path: string,
  fileBuffer: Buffer,
  contentType = "image/png"
): Promise<string> {
  const supabase = getSupabaseServiceClient();

  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, fileBuffer, { contentType, upsert: true });

  if (error) throw new Error(`Supabase upload failed: ${error.message}`);

  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
