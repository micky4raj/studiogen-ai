# Deploying StudioGen AI

Order matters here — several services need IDs/secrets from earlier steps. Follow top to bottom the first time.

## 1. Supabase

1. Create a project at supabase.com.
2. **SQL Editor** → paste and run all of `supabase/schema.sql`. This creates every table, RLS policy, the storage bucket, and the atomic credit/webhook RPCs in one shot.
3. **Authentication → Providers** → confirm Email is enabled. This project uses magic-link (`signInWithOtp`), not password auth, so no further provider setup is needed.
4. **Authentication → URL Configuration** → set:
   - Site URL: your production URL (e.g. `https://studiogen.yourdomain.com`)
   - Redirect URLs: add `https://studiogen.yourdomain.com/auth/callback` (and `http://localhost:3000/auth/callback` for local dev)
5. Copy from **Settings → API**: `Project URL`, `anon public` key, `service_role` key → these map directly to `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

**Verify before moving on**: create a throwaway account via `/login`, confirm a row appears in `user_credits` with `credits = 3`. If it doesn't, the `on_auth_user_created` trigger from `schema.sql` didn't get created — re-run the `create trigger` statement near the top of the file.

## 2. Cloudinary

1. Create an account at cloudinary.com.
2. **Add-ons** → find "AI Background Removal" → add it (has a free tier with limited monthly credits; check current pricing for your expected volume).
3. Copy `Cloud name`, `API Key`, `API Secret` from the dashboard home → `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`.

## 3. Replicate

1. Create an account at replicate.com, generate an API token → `REPLICATE_API_TOKEN`.
2. Leave `REPLICATE_MODEL_VERSION` as the default (`stability-ai/stable-diffusion-inpainting`) unless you've deliberately swapped in a different masked-inpainting model. **Do not** point this at a plain img2img/text-to-image model — see the comment in `lib/replicate.ts` for why.

## 4. Anthropic

Generate an API key at console.anthropic.com → `ANTHROPIC_API_KEY`.

## 5. Stripe

1. **Products** → create three products:
   - One-time packs (`starter`/`growth`/`scale`) don't need Stripe Products — `lib/stripe.ts` creates them inline via `price_data` at checkout time.
   - "Pro" subscription — add a recurring monthly Price → copy its Price ID → `STRIPE_PRO_PRICE_ID`.
   - "Studio" subscription — same, recurring monthly Price → `STRIPE_STUDIO_PRICE_ID`.
2. **Developers → API keys** → copy the secret key → `STRIPE_SECRET_KEY`, and the publishable key → `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.
3. **Developers → Webhooks** → add endpoint: `https://studiogen.yourdomain.com/api/webhooks/stripe`. Subscribe to: `checkout.session.completed`, `invoice.paid`, `customer.subscription.deleted`. Copy the signing secret → `STRIPE_WEBHOOK_SECRET`.
4. Test mode first: use Stripe's test card `4242 4242 4242 4242` to run through both a one-time pack purchase and a subscription signup before going live, and confirm credits actually land in `user_credits` after each.

## 6. Razorpay

1. Create an account, get API keys from **Settings → API Keys** → `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`.
2. **Settings → Webhooks** → add endpoint: `https://studiogen.yourdomain.com/api/webhooks/razorpay`, subscribe to `payment.captured`. Copy the webhook secret → `RAZORPAY_WEBHOOK_SECRET`.
3. Set real INR pricing rather than relying on the built-in USD→INR conversion: set `RAZORPAY_PRICE_STARTER_INR`, `RAZORPAY_PRICE_GROWTH_INR`, `RAZORPAY_PRICE_SCALE_INR` directly (see `lib/razorpay.ts` — these take precedence over the `RAZORPAY_USD_TO_INR_RATE` fallback when set).

## 7. Inngest (background job queue)

1. Deploy the app first (step 9) so you have a real URL — Inngest needs to reach it.
2. Create an account at inngest.com, create an app, point it at `https://studiogen.yourdomain.com/api/inngest`.
3. Copy the Event Key and Signing Key → `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`. Redeploy with these set.
4. **Verify**: trigger a generation from the UI, confirm the run shows up in the Inngest dashboard and the job transitions `queued` → `processing` → `completed`.

## 8. Upstash Redis (rate limiting)

1. Create a free Redis database at upstash.com (any region close to your deployment).
2. Copy the REST URL and token from the database dashboard → `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.
3. **This one actually matters for correctness, not just nice-to-have**: without it, rate limiting falls back to an in-memory limiter that doesn't share state across serverless instances (see `lib/rate-limit.ts`) — on Vercel that means the limit is effectively `N × your concurrent instance count`, not the real limit. Don't skip this before real traffic.

## 9. Sentry (optional but recommended)

1. Create a project at sentry.io, copy the DSN → `SENTRY_DSN`.
2. That's it for this project's minimal setup — `instrumentation.ts` and `lib/logger.ts` handle the rest. This is a lightweight manual init, not the full Sentry Next.js SDK wizard (no source-map upload, no client-side session replay) — run `npx @sentry/wizard@latest -i nextjs` yourself later if you want that.

## 10. Deploy (Vercel)

1. Push to a GitHub repo (the `.gitignore` added in this project keeps `node_modules`/`.env.local` out of it).
2. Import the repo in Vercel.
3. Add every env var from `.env.example` in **Settings → Environment Variables** (use the real values gathered above, not the placeholders).
4. Deploy. `sharp` (used for the inpainting mask math) works out of the box on Vercel's Node.js runtime — no special config needed as long as no route touching `lib/mask.ts` is set to `export const runtime = 'edge'`.
5. Go back and finish step 7 (Inngest) now that you have a real URL, then redeploy with those two keys set.

## Post-deploy smoke test

Run through this once, in order, before calling it launched:

1. Sign up with a real email → confirm the magic link arrives and `/dashboard` loads with **3 credits** shown in the header.
2. Upload a product photo, enter a niche, generate → confirm the page shows "Generating…", polls, and eventually shows a 4-image contact sheet where the product itself looks unmodified (this is the actual point of the masked-inpainting pipeline — if the product looks redrawn, something's misconfigured in step 3).
3. Confirm listing copy appears underneath, and that credits dropped to 2.
4. Buy a `starter` pack with Stripe test card `4242 4242 4242 4242` → confirm credits jump by 20 and the balance updates without a page refresh.
5. Subscribe to "Pro" → confirm the subscription's first `invoice.paid` webhook lands and credits are granted.
6. Deliberately break something (e.g. temporarily rename `REPLICATE_API_TOKEN` in Vercel and redeploy) → run a generation → confirm the job shows `failed` with an error message **and the spent credit reappears in the balance**. This is the refund path from `lib/inngest/functions.ts` — worth confirming it actually fires before you trust it in production. Revert the env var change afterward.
