/**
 * Next.js calls this once per runtime (nodejs, edge) on startup. This is the
 * single place Sentry gets initialized — no changes needed anywhere else as
 * long as errors flow through lib/logger.ts:logger.error.
 *
 * Only activates if SENTRY_DSN is set, so local dev without a Sentry project
 * configured works unchanged (logger.ts falls back to console-only).
 */
export async function register() {
  if (!process.env.SENTRY_DSN) return;

  if (process.env.NEXT_RUNTIME === "nodejs") {
    const Sentry = await import("@sentry/nextjs");
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      tracesSampleRate: 0.1,
      environment: process.env.NODE_ENV,
    });
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    const Sentry = await import("@sentry/nextjs");
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      tracesSampleRate: 0.1,
      environment: process.env.NODE_ENV,
    });
  }
}
