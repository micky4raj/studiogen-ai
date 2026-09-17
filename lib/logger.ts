/**
 * Thin logging wrapper used across all API routes and lib functions instead
 * of raw console.error. Two reasons this exists rather than just calling
 * console.error everywhere (which every route in this project did until now):
 *
 * 1. Structured context — every call takes a `context` object (userId, jobId,
 *    route, etc.) so errors are actually searchable/groupable in whatever log
 *    aggregator you point this at, instead of free-text strings.
 * 2. A single place to wire up Sentry (or any other error tracker) — set
 *    SENTRY_DSN and errors reported via `logger.error` are captured there in
 *    addition to stdout, with no call-site changes needed.
 */

type LogContext = Record<string, unknown>;

const hasSentry = !!process.env.SENTRY_DSN;

// Lazy import so this file doesn't hard-fail in environments/tests that don't
// have @sentry/nextjs configured (e.g. before `npx @sentry/wizard` has run).
async function reportToSentry(error: unknown, context?: LogContext) {
  if (!hasSentry) return;
  try {
    const Sentry = await import("@sentry/nextjs");
    Sentry.captureException(error, { extra: context });
  } catch {
    // Sentry not installed/configured — logging to console is still enough.
  }
}

export const logger = {
  error(message: string, error?: unknown, context?: LogContext) {
    console.error(`[error] ${message}`, { error, ...context });
    void reportToSentry(error ?? new Error(message), { message, ...context });
  },

  warn(message: string, context?: LogContext) {
    console.warn(`[warn] ${message}`, context ?? {});
  },

  info(message: string, context?: LogContext) {
    console.log(`[info] ${message}`, context ?? {});
  },
};
