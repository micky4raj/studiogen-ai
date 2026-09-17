"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Client-side errors don't hit any server route, so they never reach
    // lib/logger.ts on their own — log here so they're at least visible in
    // the browser console with the digest Next.js uses to correlate against
    // server logs, and wire this to Sentry's client SDK if you add it later.
    console.error("[client-error]", error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="font-display text-2xl">Something went wrong</h1>
      <p className="text-sm text-muted">
        That's on us, not you. Try again, and if it keeps happening let us know.
      </p>
      <Button variant="accent" onClick={reset}>
        Try again
      </Button>
    </main>
  );
}
