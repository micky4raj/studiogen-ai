"use client";

import { useEffect } from "react";

// global-error.tsx replaces the ENTIRE page (including <html>/<body>) when an
// error escapes the root layout — app/error.tsx can't catch that case because
// a boundary can never catch errors thrown by its own parent segment. Kept
// deliberately plain (no Tailwind classes, no shared components) since if the
// root layout itself is broken, anything depending on it might be too.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global-error]", error);
  }, [error]);

  return (
    <html>
      <body style={{ fontFamily: "sans-serif", padding: "2rem", textAlign: "center" }}>
        <h1>Something went wrong</h1>
        <p>Please refresh the page. If this keeps happening, let us know.</p>
        <button onClick={reset} style={{ marginTop: "1rem", padding: "0.5rem 1rem" }}>
          Try again
        </button>
      </body>
    </html>
  );
}
