# StudioGen AI — Production-Grade Skeleton

AI Product Photo Studio & SEO Copywriting platform.

## Stack
- Next.js 14 (App Router, TypeScript) + Tailwind + Shadcn-style components
- **Anthropic Claude** — background prompt generation + SEO copywriting
- **Replicate** (Stable Diffusion **inpainting**) — masked studio image generation that preserves the exact product
- **Supabase** — Auth, Storage, Postgres (with atomic RPCs + RLS)
- **Inngest** — background job queue for the multi-step image pipeline
- **Upstash Redis** — rate limiting
- **Stripe** + **Razorpay** — credit packs, both with idempotent webhooks

## Setup
This section is for **local development**. For deploying to production — Supabase, Cloudinary, Stripe, Razorpay, Inngest, Upstash, and Vercel, in the order each needs the last — see **[DEPLOYMENT.md](./DEPLOYMENT.md)**.

1. `cp .env.example .env.local` and fill in all keys.
2. Run `supabase/schema.sql` in your Supabase project's SQL editor (includes tables, RLS policies, and the `deduct_credits` / `refund_credits` / `add_credits` RPCs).
3. Enable Cloudinary's **AI Background Removal** add-on on your Cloudinary account.
4. `npm install`
5. Local dev needs two processes:
   - `npm run dev`
   - `npx inngest-cli@latest dev` (runs the local Inngest dev server that executes `generateStudioShoot`)
6. Without Upstash env vars set, rate limiting silently falls back to an in-memory limiter — fine for local dev, not for production (see below).

## Request flow (why it's shaped this way)

**Image pipeline** — `POST /api/generate-images`:
1. `requireUser()` resolves identity from the **session cookie** — the route no longer trusts a `userId` field in the request body. (An earlier version did; any caller could pass someone else's ID.)
2. Rate limit + Zod-validate the body.
3. `deduct_credits` Postgres RPC — atomic `UPDATE ... WHERE credits >= amount`, so two concurrent requests can't both pass a stale balance check and drive credits negative.
4. Insert a `generation_jobs` row with `status: "queued"`, enqueue an Inngest event, **return 202 immediately** with a `jobId`.
5. `lib/inngest/functions.ts:generateStudioShoot` does the actual work out-of-band: background removal → Claude prompts → mask/flatten prep → Replicate inpainting → re-host to Storage → mark job `completed`. Each step is individually retried by Inngest. On any failure, the job is marked `failed` and `refund_credits` runs automatically.
6. The frontend polls `GET /api/jobs/:jobId` (RLS-scoped, so a user can only ever read their own job) until it sees `completed` or `failed`.

This replaces an earlier version that ran all of this inline inside one HTTP request — a real risk of exceeding a serverless function's timeout, and exactly the "Queue System" called for in the original spec.

**Why inpainting, not img2img**: the product photo needs to survive generation pixel-for-pixel; only the background should change. `lib/mask.ts` derives a mask from the background-removed image's alpha channel (transparent → white/regenerate, opaque product → black/preserve) and flattens the transparent PNG onto white for a valid model input. `lib/replicate.ts` passes both `image` and `mask` to a proper inpainting model. A plain img2img/text-to-image model has no mask input and can redraw the product itself.

**Copywriting** — `POST /api/copywriting`: same auth + rate-limit + validation pattern. Claude's HTML output is passed through `sanitize-html` before it's ever sent to the client, since it's rendered with `dangerouslySetInnerHTML`.

**Credits & billing**:
- `GET /api/credits` — balance for the signed-in user only (no more `?userId=` that let anyone query anyone's balance)
- `POST /api/credits` / `POST /api/credits/razorpay` — create a Stripe Checkout session / Razorpay order for the signed-in user
- `POST /api/webhooks/stripe` / `POST /api/webhooks/razorpay` — verify signature, **dedupe by event ID** against `processed_webhook_events` (both providers retry on any non-2xx or timeout — without this, a retried delivery double-credits the user), then call `add_credits` RPC

## Auth flow
1. `/login` — magic link via `signInWithOtp`
2. `/auth/callback` exchanges the code for a session cookie
3. `middleware.ts` refreshes the session on every request and redirects signed-out visitors away from `/dashboard`
4. Every API route calls `requireUser()` (`lib/auth.ts`) and 401s if there's no session — identity is never accepted from the client

## Design system
Studio "contact sheet" theme — paper-white background, graphite text, one tungsten-amber accent, Space Grotesk headings + Inter body. See the token block at the top of `app/globals.css`. Numbered steps in the dashboard reflect the real upload → niche → generate sequence.

## Test/audit pass (this revision)
No live Next.js build was available in this environment (sandboxed, no package registry access), so verification here was: (1) a `tsc --noEmit` pass against the actual source with hand-written type shims for every external package, to catch cross-file structural bugs, and (2) a manual trace of every money/state-transition path, since a type-checker can't catch race conditions or logic gaps. Real issues found and fixed in this pass:

- **Build-breaking**: `lib/stripe.ts` / `lib/razorpay.ts` imported a `CreditPack` type from the wrong module (never exported from `lib/credits.ts`) — would have failed `next build` outright.
- **Build-breaking**: the rewritten Stripe webhook referenced `supabase` without declaring it — every single Stripe webhook delivery would 500.
- **Silent credit loss**: `/api/generate-images` deducted credits *before* persisting the job row and *before* enqueueing the Inngest event; a failure at either later step lost the user's credit with no refund, or left a job stuck in `queued` forever. Reordered to create the job first, and added rollback/refund at each failure point.
- **New users got 0 free credits, not 3**: the `default 3` on `user_credits.credits` was dead code — nothing ever inserted a row for a new signup. Added an `on_auth_user_created` trigger.
- **Webhook idempotency had a gap of its own**: the original fix (insert a dedupe row, then separately call `add_credits`) could mark an event "processed" and then fail to actually credit it, permanently losing that purchase on retry. Combined both into one `record_and_credit_webhook_event` RPC so they commit or roll back together.
- **Razorpay dedupe key**: the fallback used the generic event name for non-`payment.captured` events, which would falsely collide across unrelated payments. Now only processes (and only dedupes) `payment.captured`, keyed by the stable payment id.
- **Storage bucket never existed**: `UploadDropzone` uploads directly from the browser under the anon key, but no bucket or RLS policy was ever defined — every upload would have failed with a permission error. Added bucket creation + scoped insert/select policies.
- **snake_case/camelCase mismatch**: `/api/jobs/:jobId` returned the raw Postgres row while the `ImageGenerationJob` type declares camelCase fields. It happened to work only because the specific fields the UI reads are single words where both cases collide — `job.backgroundRemovedUrl` or `job.createdAt` would have silently been `undefined`. Added an explicit mapper.
- **Inngest retry semantics**: function-level `retries: 2` combined with our own refund-on-failure logic meant a failed run would refund once, then replay memoized steps and immediately re-throw on each retry — no benefit, just noise in the dashboard. Set to `retries: 0` since `step.run` already retries transient failures within each step.
- Added a 10MB client-side file-size guard on upload (nothing previously stopped an oversized file from being sent to Cloudinary/Replicate).

## Test/audit pass, round 2
A follow-up pass through the frontend components and remaining money-adjacent logic:

- **Checkout error handling**: `UpgradeDialog` and `RazorpayButton` read `checkoutUrl`/`order` straight off the fetch response without checking `res.ok` — a 401 (expired session) or 429 (rate limited) would redirect the browser to `undefined` or hand Razorpay's SDK garbage input, both silently. Both now check status and surface a real error message.
- **Dead prop**: `UpgradeDialog` still accepted a `userId` prop that nothing inside it used after the earlier session-based auth refactor. Removed, along with the stale value being passed in from the dashboard.
- **Error-masking in `getCreditBalance`**: a real database error (timeout, outage) and "user genuinely has 0 credits" produced an identical return value. A transient Supabase issue would have shown "you're out of credits" to a user who wasn't. Now only a genuine "no row" result returns 0; other errors throw and surface as a proper 500.
- **Missing balance display**: the dashboard never showed the user's credit count anywhere — the only way to discover you're empty was to hit generate and get a 402. Added a live balance in the header (refreshed after enqueueing, and after each job resolves/refunds), plus pre-emptively disabling the generate button at 0 rather than waiting on a round trip.
- Re-ran the full `tsc --noEmit` shim pass after all of the above — clean.

## Test/audit pass, round 3 — observability, subscriptions, and a real test suite
This round closed out the remaining README TODOs (subscriptions, structured logging) and added an actually-runnable test suite, plus caught a few more issues along the way:

- **Stray directory shipping in every zip since turn one**: the very first `mkdir -p .../{app/api/a,app/api/b,...}` command didn't get brace-expanded in that shell context, so it created a literal nested directory named `{app/api/...}` sitting in the project root. Harmless (empty), but it's been silently included in every delivered zip. Removed.
- **Stale env default would have reintroduced a fixed bug**: `.env.example` still listed the old Flux img2img model (`black-forest-labs/flux-1.1-pro`) as `REPLICATE_MODEL_VERSION`, despite the code having moved to masked inpainting specifically because that model can redraw the product. Anyone copying the example file verbatim would have silently undone that fix. Corrected to the real default and added a comment explaining why it must stay a masked-inpainting model.
- **`/api/subscribe` existed with no caller**: `lib/stripe.ts:createSubscriptionCheckout` and the Postgres subscription-linkage RPCs were already built, but nothing in the UI ever hit them and the webhook never handled `invoice.paid` / `customer.subscription.deleted`. Implemented both webhook handlers and added subscription plans to `UpgradeDialog`.
- **Subscription renewal crediting avoids a webhook-ordering race**: `invoice.paid` reads `userId`/`plan` from the Stripe Subscription object's own metadata (set at checkout creation) rather than looking the user up by `stripe_customer_id` in our DB — Stripe doesn't guarantee webhook delivery order, so a DB lookup could fail if `invoice.paid` arrived before `checkout.session.completed` had a chance to link the customer.
- **Invalid test API usage**: an early draft of the credits sanity tests used `expect(value, message)`, a Chai pattern Vitest's `expect()` doesn't support — would have failed to even parse as a real test. Rewritten with `it.each` for the same per-entry coverage with real failure messages.
- Extracted `lib/mask.ts`'s actual mask-derivation math into a pure `deriveInpaintingBuffers` function (buffer in, buffer out — no fetch, no Supabase) specifically so the correctness-critical transformation from the earlier inpainting fix is unit-testable against a synthetic image with a known alpha pattern.
- Added `vitest.config.ts` and a real test suite: request-validation schemas, the in-memory rate-limit fallback (using fake timers to test window expiry deterministically), pricing-constant sanity checks, and the mask math. Run with `npm test`.
- Added `lib/logger.ts` (structured JSON + lazy Sentry forwarding) and wired it into every route that was still using raw `console.error`; added `instrumentation.ts` for Sentry init and `SENTRY_DSN` to `.env.example`.

**Honesty note on verification**: this sandbox has no package registry access, so none of the above — including the new test suite — has been run against real installed dependencies. Every fix in this round (and prior rounds) was verified with `tsc --noEmit` against the actual source using hand-written type shims for every external package, which catches structural/cross-file bugs but not runtime behavior. Run `npm install && npm test` yourself before trusting this in production.

## CI
`.github/workflows/ci.yml` runs on every push/PR to `main`: typecheck → lint → test, then a separate `build` job (needs `verify` to pass first) confirms `next build` actually succeeds. All jobs use placeholder env values — nothing here needs real Supabase/Stripe/Anthropic credentials to pass, since the test suite only exercises pure logic (validation, rate-limiting, pricing constants, the mask math) and the build only needs env vars to *exist*, not to be valid.

Also added in this pass, both genuinely missing before: a `.gitignore` (without one, `node_modules`, `.next`, and any real `.env.local` you created would all be tracked by git) and `.eslintrc.json` (without one, `next lint` prompts interactively to create a config on first run — which would hang the CI job indefinitely rather than fail fast).

## Round 4 — basic App Router hygiene
Every prior round focused on backend correctness and money logic. This pass covered baseline production hygiene that had never been touched: `app/error.tsx` / `app/global-error.tsx` (without these, an unhandled render error shows Next's generic blank error screen instead of anything on-brand or recoverable), `app/not-found.tsx`, `app/dashboard/loading.tsx`, `app/robots.ts` / `app/sitemap.ts` (keeping `/dashboard` and `/api` out of search indexes — a leaked job ID or generated image URL in a search result would be a real, if minor, privacy issue), an `app/icon.svg` favicon, fuller `<head>` metadata (OG tags, theme-color), a lightweight `/api/health` endpoint for uptime monitoring, and safe security headers (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`) in `next.config.js`.

**Deliberately not included**: a Content-Security-Policy. This app loads Razorpay's `checkout.js` from an external origin, and a CSP that "should work" without testing against the actual running app risks silently breaking checkout or auth — that's the kind of thing to build iteratively in a staging environment with the browser console open, not guess at from a code-only pass. Left as a documented TODO in `next.config.js` rather than shipping something unverified.

## What's genuinely production-ready vs. what to still verify
| Piece | Status |
|---|---|
| Auth, session handling, route protection | Real, session-derived everywhere |
| Credit deduction/refund/top-up | Atomic via Postgres RPC, race-free |
| Webhooks | Signature-verified and idempotent |
| Image pipeline | Real queue (Inngest), real inpainting with a derived mask, job persistence |
| Rate limiting | Real with Upstash configured; **falls back to a non-distributed in-memory limiter without it** — set Upstash env vars before deploying to more than one instance |
| Input validation | Zod on every mutating route |
| HTML sanitization | Applied to all Claude-generated HTML before render |
| Replicate model params | `stability-ai/stable-diffusion-inpainting` input shape is standard, but re-check `num_inference_steps`/`guidance_scale` against whichever version you pin |
| Razorpay pricing | Uses a hardcoded USD→INR conversion in `lib/razorpay.ts` — replace with real INR pricing or a live FX source |
| Subscriptions | Real: `invoice.paid` grants monthly credits, `customer.subscription.deleted` downgrades, both wired through `UpgradeDialog` |
| Observability | Structured logging (`lib/logger.ts`) everywhere; Sentry forwarding activates automatically once `SENTRY_DSN` is set |
| Tests | Real Vitest suite covering validation schemas, rate-limit fallback, pricing sanity, and the inpainting mask math — not yet executed against real installed deps in this environment, see audit notes above |
