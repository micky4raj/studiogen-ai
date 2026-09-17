-- Run this in the Supabase SQL editor to set up StudioGen AI's tables.
-- Assumes Supabase Auth is being used for `auth.users`.

create table if not exists user_credits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  credits integer not null default 3,       -- 3 free credits on signup
  plan text not null default 'free',        -- 'free' | 'subscription' | 'payg'
  stripe_customer_id text,
  stripe_subscription_id text,
  subscription_plan text,                   -- 'pro' | 'studio' | null
  updated_at timestamptz not null default now()
);

create unique index if not exists user_credits_stripe_customer_id_idx
  on user_credits (stripe_customer_id) where stripe_customer_id is not null;

create table if not exists credit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount integer not null,                  -- negative = deduction, positive = top-up
  reason text not null,                     -- 'image_generation' | 'purchase' | 'subscription_renewal' | 'refund'
  job_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists generation_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'queued',    -- 'queued' | 'processing' | 'completed' | 'failed'
  original_image_url text not null,
  background_removed_url text,
  niche text not null,
  prompts jsonb,
  results jsonb,                            -- array of { id, url, replicatePredictionId, prompt }
  credits_charged integer not null default 1,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists product_copy (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid references generation_jobs(id) on delete set null,
  seo_title text not null,
  bullet_points jsonb not null,             -- array of 5 strings
  description_html text not null,
  created_at timestamptz not null default now()
);

-- Dedup table for webhook deliveries. Stripe and Razorpay both retry on any
-- non-2xx or timeout, so without this a retried webhook double-credits the user.
create table if not exists processed_webhook_events (
  provider text not null,                   -- 'stripe' | 'razorpay'
  event_id text not null,
  processed_at timestamptz not null default now(),
  primary key (provider, event_id)
);

-- Auto-provision a credits row for every new signup. Without this trigger,
-- the `default 3` above is dead code — nothing ever inserts into user_credits,
-- so getCreditBalance() would silently return 0 for every new user instead of
-- the intended 3 free credits.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.user_credits (user_id, credits, plan)
  values (new.id, 3, 'free');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------- Row Level Security ----------
alter table user_credits enable row level security;
alter table credit_transactions enable row level security;
alter table generation_jobs enable row level security;
alter table product_copy enable row level security;

create policy "Users can view own credits" on user_credits
  for select using (auth.uid() = user_id);

create policy "Users can view own transactions" on credit_transactions
  for select using (auth.uid() = user_id);

create policy "Users can view own jobs" on generation_jobs
  for select using (auth.uid() = user_id);

create policy "Users can view own copy" on product_copy
  for select using (auth.uid() = user_id);

-- All inserts/updates to these tables go through server-side API routes using
-- SUPABASE_SERVICE_ROLE_KEY (see lib/supabase.ts), which bypasses RLS by design.
-- Do not expose service-role writes directly from the client.

-- ---------- Atomic credit RPCs ----------
-- Using `SECURITY DEFINER` functions instead of app-level read-then-write
-- closes the race where two concurrent requests both read the same balance
-- and both pass an insufficient-credits check.

create or replace function deduct_credits(p_user_id uuid, p_amount integer, p_job_id uuid)
returns boolean
language plpgsql
security definer
as $$
declare
  v_updated integer;
begin
  update user_credits
  set credits = credits - p_amount, updated_at = now()
  where user_id = p_user_id and credits >= p_amount
  returning credits into v_updated;

  if v_updated is null then
    return false; -- insufficient credits — caller maps this to a 402
  end if;

  insert into credit_transactions (user_id, amount, reason, job_id)
  values (p_user_id, -p_amount, 'image_generation', p_job_id);

  return true;
end;
$$;

create or replace function refund_credits(p_user_id uuid, p_amount integer, p_job_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  update user_credits
  set credits = credits + p_amount, updated_at = now()
  where user_id = p_user_id;

  insert into credit_transactions (user_id, amount, reason, job_id)
  values (p_user_id, p_amount, 'refund', p_job_id);
end;
$$;

create or replace function add_credits(p_user_id uuid, p_amount integer, p_reason text)
returns void
language plpgsql
security definer
as $$
begin
  insert into user_credits (user_id, credits, plan, updated_at)
  values (p_user_id, p_amount, 'payg', now())
  on conflict (user_id)
  do update set credits = user_credits.credits + p_amount, updated_at = now();

  insert into credit_transactions (user_id, amount, reason)
  values (p_user_id, p_amount, p_reason);
end;
$$;

-- Grant execute to the service role (and authenticated, if you ever call these
-- from RLS-scoped client code instead of the service-role server client).
grant execute on function deduct_credits(uuid, integer, uuid) to service_role;
grant execute on function refund_credits(uuid, integer, uuid) to service_role;
grant execute on function add_credits(uuid, integer, text) to service_role;

-- ---------- Atomic webhook processing ----------
-- A naive "insert dedupe row, then call add_credits" from application code has
-- a gap: if add_credits fails *after* the dedupe row commits (network blip,
-- app crash), the webhook is marked processed but the user was never credited
-- — and the provider's retry of that same event will be silently swallowed by
-- the dedupe check, permanently losing the purchase. Wrapping both operations
-- in one PL/pgSQL function means they commit or roll back together.
create or replace function record_and_credit_webhook_event(
  p_provider text,
  p_event_id text,
  p_user_id uuid,
  p_amount integer,
  p_reason text
)
returns boolean -- true if this call newly processed the event, false if it was a dup
language plpgsql
security definer
as $$
begin
  insert into processed_webhook_events (provider, event_id)
  values (p_provider, p_event_id)
  on conflict (provider, event_id) do nothing;

  if not found then
    return false; -- already processed — caller should treat this as a no-op ack
  end if;

  perform add_credits(p_user_id, p_amount, p_reason);
  return true;
end;
$$;

grant execute on function record_and_credit_webhook_event(text, text, uuid, integer, text) to service_role;

-- ---------- Subscription linkage ----------
-- checkout.session.completed (subscription mode) stores the Stripe customer/
-- subscription IDs here; invoice.paid looks the user up by customer_id to
-- grant that cycle's credits; customer.subscription.deleted clears it back to
-- 'free'. None of these grant credits themselves — only record_and_credit_
-- webhook_event does that, keeping the crediting logic in one place.
create or replace function link_stripe_subscription(
  p_user_id uuid, p_customer_id text, p_subscription_id text, p_plan text
)
returns void
language plpgsql
security definer
as $$
begin
  update user_credits
  set stripe_customer_id = p_customer_id,
      stripe_subscription_id = p_subscription_id,
      subscription_plan = p_plan,
      plan = 'subscription',
      updated_at = now()
  where user_id = p_user_id;
end;
$$;

create or replace function cancel_stripe_subscription(p_customer_id text)
returns void
language plpgsql
security definer
as $$
begin
  update user_credits
  set plan = 'free',
      subscription_plan = null,
      stripe_subscription_id = null,
      updated_at = now()
  where stripe_customer_id = p_customer_id;
end;
$$;

grant execute on function link_stripe_subscription(uuid, text, text, text) to service_role;
grant execute on function cancel_stripe_subscription(text) to service_role;

-- ---------- Storage bucket + policies ----------
-- Server-side uploads (re-hosting Replicate output, mask generation) use the
-- service-role client and bypass RLS entirely. But components/upload-dropzone.tsx
-- uploads the RAW product photo directly from the browser using the anon key —
-- without a bucket and RLS policies below, that upload has no permission to
-- write anywhere and fails outright.
insert into storage.buckets (id, name, public)
values ('product-photos', 'product-photos', true)
on conflict (id) do nothing;

-- Users may only upload into a path prefixed with their own user id
-- (UploadDropzone writes to `${userId}/raw/...`), preventing one user from
-- writing into another's folder.
create policy "Users upload to their own folder"
on storage.objects for insert
with check (
  bucket_id = 'product-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- The bucket is public so generated studio shots and mask/flatten intermediates
-- can be served directly via their public URL without a signed-URL round trip.
create policy "Public read access to product photos"
on storage.objects for select
using (bucket_id = 'product-photos');
