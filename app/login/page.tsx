"use client";

import { useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSendLink(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });

    setLoading(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="font-display text-2xl">Sign in to StudioGen AI</h1>
        <p className="mt-1 text-sm text-muted">We&apos;ll email you a link — no password needed.</p>
      </div>

      {sent ? (
        <p className="rounded-sm border border-border p-4 text-sm">
          Check <strong>{email}</strong> for a sign-in link.
        </p>
      ) : (
        <form onSubmit={handleSendLink} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@brand.com"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" variant="accent" className="w-full" disabled={loading}>
            {loading ? "Sending…" : "Send magic link"}
          </Button>
        </form>
      )}
    </main>
  );
}
