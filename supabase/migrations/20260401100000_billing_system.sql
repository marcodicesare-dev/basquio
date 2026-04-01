-- Billing system: subscriptions, credit grants, Stripe webhook idempotency, stripe customers
-- Migrates from flat credit_ledger balance to grant-based FIFO consumption.

-- ─── STRIPE CUSTOMERS MAPPING ─────────────────────────────────
create table if not exists public.stripe_customers (
  user_id            uuid primary key references auth.users(id),
  stripe_customer_id text unique not null,
  created_at         timestamptz default now()
);

alter table public.stripe_customers enable row level security;
create policy "Users see own stripe mapping"
  on public.stripe_customers for select using (auth.uid() = user_id);

-- ─── SUBSCRIPTIONS ────────────────────────────────────────────
create table if not exists public.subscriptions (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references auth.users(id),
  stripe_customer_id      text not null,
  stripe_subscription_id  text unique not null,
  plan                    text not null check (plan in ('starter', 'pro', 'team')),
  billing_interval        text not null check (billing_interval in ('monthly', 'annual')),
  status                  text not null check (status in ('active', 'past_due', 'canceled', 'incomplete')),
  current_period_start    timestamptz not null,
  current_period_end      timestamptz not null,
  cancel_at_period_end    boolean default false,
  template_slots_included integer not null default 0,
  credits_included        integer not null default 0,
  created_at              timestamptz default now(),
  updated_at              timestamptz default now()
);

create index if not exists idx_subscriptions_user on public.subscriptions(user_id);
create index if not exists idx_subscriptions_stripe_sub on public.subscriptions(stripe_subscription_id);

alter table public.subscriptions enable row level security;
create policy "Users see own subscription"
  on public.subscriptions for select using (auth.uid() = user_id);

-- ─── CREDIT GRANTS (rollover + expiry) ───────────────────────
create table if not exists public.credit_grants (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id),
  source          text not null check (source in ('subscription', 'purchase', 'promotional', 'free_tier')),
  original_amount integer not null,
  remaining       integer not null check (remaining >= 0),
  granted_at      timestamptz default now(),
  expires_at      timestamptz not null,
  stripe_event_id text,
  created_at      timestamptz default now()
);

-- Unique on stripe_event_id for idempotent webhook processing (NULLs bypass unique)
create unique index if not exists idx_credit_grants_stripe_event
  on public.credit_grants(stripe_event_id) where stripe_event_id is not null;

-- Unique on free_tier per user (one free grant per user)
create unique index if not exists idx_credit_grants_free_tier_unique
  on public.credit_grants(user_id) where source = 'free_tier';

create index if not exists idx_credit_grants_user_active
  on public.credit_grants (user_id, expires_at)
  where remaining > 0;

alter table public.credit_grants enable row level security;
create policy "Users see own grants"
  on public.credit_grants for select using (auth.uid() = user_id);

-- ─── STRIPE WEBHOOK EVENTS (idempotency) ─────────────────────
create table if not exists public.stripe_webhook_events (
  id         text primary key, -- Stripe event ID (evt_...)
  type       text not null,
  processed  boolean default false,
  created_at timestamptz default now()
);

-- ─── USER TEMPLATES ───────────────────────────────────────────
create table if not exists public.user_templates (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id),
  name              text not null,
  pptx_storage_path text not null,
  is_active         boolean default true,
  created_at        timestamptz default now()
);

alter table public.user_templates enable row level security;
create policy "Users see own templates"
  on public.user_templates for select using (auth.uid() = user_id);

-- ─── DEBIT CREDITS FIFO ──────────────────────────────────────
-- Consume credits from earliest-expiring grants first.
-- Also writes an audit row to credit_ledger for backwards compat.
create or replace function public.debit_credits_fifo(
  p_user_id uuid,
  p_amount integer,
  p_reason text,
  p_reference_id text
) returns table (success boolean, balance_after integer) as $$
declare
  v_remaining integer := p_amount;
  v_grant record;
  v_total_available integer;
begin
  -- Lock user's grants for atomic consumption
  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  -- Check total available (non-expired, non-zero)
  select coalesce(sum(credit_grants.remaining), 0) into v_total_available
  from public.credit_grants
  where credit_grants.user_id = p_user_id
    and credit_grants.remaining > 0
    and credit_grants.expires_at > now();

  if v_total_available < p_amount then
    return query select false, v_total_available;
    return;
  end if;

  -- Consume from earliest expiring first (FIFO)
  for v_grant in
    select credit_grants.id, credit_grants.remaining
    from public.credit_grants
    where credit_grants.user_id = p_user_id
      and credit_grants.remaining > 0
      and credit_grants.expires_at > now()
    order by credit_grants.expires_at asc
  loop
    if v_remaining <= 0 then exit; end if;

    if v_grant.remaining >= v_remaining then
      update public.credit_grants set remaining = credit_grants.remaining - v_remaining where credit_grants.id = v_grant.id;
      v_remaining := 0;
    else
      v_remaining := v_remaining - v_grant.remaining;
      update public.credit_grants set remaining = 0 where credit_grants.id = v_grant.id;
    end if;
  end loop;

  -- Write audit trail to legacy credit_ledger
  insert into public.credit_ledger (user_id, amount, reason, reference_id)
  values (p_user_id, -p_amount, p_reason, p_reference_id);

  -- Return success + new balance
  return query select true, (v_total_available - p_amount)::integer;
end;
$$ language plpgsql security definer;

-- ─── GRANT FREE TIER CREDITS (new: 40 credits via credit_grants) ──
-- Replaces the old 6-credit grant. Uses credit_grants table.
-- Idempotent via unique partial index on (user_id) where source = 'free_tier'.
create or replace function public.grant_free_tier_credit_v2(
  p_user_id uuid
) returns boolean
language plpgsql
security definer
as $$
begin
  insert into public.credit_grants (user_id, source, original_amount, remaining, expires_at)
  values (p_user_id, 'free_tier', 40, 40, '2099-12-31'::timestamptz)
  on conflict (user_id) where source = 'free_tier'
  do nothing;

  -- Also write to legacy credit_ledger for backwards compat (if not already there)
  insert into public.credit_ledger (user_id, amount, reason)
  values (p_user_id, 40, 'free_tier')
  on conflict (user_id) where reason = 'free_tier'
  do update set amount = 40;

  return found;
end;
$$;

-- ─── MIGRATE EXISTING USERS ──────────────────────────────────
-- For users who already have free_tier grants in credit_ledger,
-- create matching credit_grants rows so they don't lose credits.
-- Existing free tier was 6 credits; upgrade to 40.
insert into public.credit_grants (user_id, source, original_amount, remaining, expires_at)
select
  cl.user_id,
  'free_tier',
  40,
  -- Give them 40 minus what they've already spent
  greatest(0, 40 + coalesce((
    select sum(cl2.amount) from public.credit_ledger cl2
    where cl2.user_id = cl.user_id and cl2.reason = 'run_debit'
  ), 0))::integer,
  '2099-12-31'::timestamptz
from public.credit_ledger cl
where cl.reason = 'free_tier'
on conflict (user_id) where source = 'free_tier'
do nothing;

-- Migrate existing purchase_pack grants to credit_grants
insert into public.credit_grants (user_id, source, original_amount, remaining, expires_at, stripe_event_id)
select
  cl.user_id,
  'purchase',
  cl.amount,
  cl.amount, -- Full amount (purchases haven't been partially consumed in old model)
  now() + interval '12 months',
  cl.reference_id
from public.credit_ledger cl
where cl.reason = 'purchase_pack' and cl.amount > 0
on conflict (stripe_event_id) where stripe_event_id is not null
do nothing;

-- ─── UPDATE CREDIT BALANCES VIEW ─────────────────────────────
-- Now reads from credit_grants (source of truth) instead of credit_ledger
create or replace view public.credit_balances as
  select
    credit_grants.user_id,
    coalesce(sum(credit_grants.remaining) filter (
      where credit_grants.remaining > 0 and credit_grants.expires_at > now()
    ), 0)::integer as balance,
    count(*) filter (where credit_grants.source = 'free_tier') as free_grants_count,
    coalesce((
      select count(*) from public.credit_ledger
      where credit_ledger.user_id = credit_grants.user_id and credit_ledger.reason = 'run_debit'
    ), 0)::bigint as total_runs
  from public.credit_grants
  group by credit_grants.user_id;

-- ─── UPDATE refund_run_credit TO RESTORE credit_grants ───────
-- The refund RPC must create a credit_grant (new system) in addition to
-- the audit trail in credit_ledger. Otherwise refunded credits are invisible.
create or replace function public.refund_run_credit(
  p_run_id uuid
) returns table (
  refunded boolean,
  amount integer
)
language plpgsql
security definer
as $$
declare
  v_user_id uuid;
  v_debit_amount integer;
begin
  select requested_by
  into v_user_id
  from public.deck_runs
  where id = p_run_id;

  if v_user_id is null then
    return query
    select false, 0;
    return;
  end if;

  select abs(credit_ledger.amount)
  into v_debit_amount
  from public.credit_ledger as credit_ledger
  where credit_ledger.reference_id = p_run_id::text
    and credit_ledger.reason = 'run_debit'
  order by credit_ledger.created_at desc
  limit 1;

  if v_debit_amount is null or v_debit_amount <= 0 then
    return query
    select false, 0;
    return;
  end if;

  -- Audit trail in credit_ledger (backwards compat)
  insert into public.credit_ledger (user_id, amount, reason, reference_id)
  values (v_user_id, v_debit_amount, 'refund', p_run_id::text)
  on conflict do nothing;

  -- Restore credits in credit_grants (new system, never expires)
  if found then
    insert into public.credit_grants (user_id, source, original_amount, remaining, expires_at, stripe_event_id)
    values (v_user_id, 'promotional', v_debit_amount, v_debit_amount, '2099-12-31'::timestamptz, 'refund_' || p_run_id::text)
    on conflict (stripe_event_id) where stripe_event_id is not null
    do nothing;
  end if;

  return query
  select found, case when found then v_debit_amount else 0 end;
end;
$$;

-- ─── UPDATE enqueue_deck_run TO USE credit_grants ────────────
-- The enqueue RPC was reading balance from credit_ledger (old system).
-- Now it uses debit_credits_fifo which reads from credit_grants (new system).
create or replace function public.enqueue_deck_run(
  p_run_id uuid,
  p_attempt_id uuid,
  p_organization_id uuid,
  p_project_id uuid,
  p_requested_by uuid,
  p_brief jsonb,
  p_business_context text,
  p_client text,
  p_audience text,
  p_objective text,
  p_thesis text,
  p_stakes text,
  p_source_file_ids uuid[],
  p_target_slide_count integer default 10,
  p_author_model text default 'claude-sonnet-4-6',
  p_template_profile_id uuid default null,
  p_recipe_id uuid default null,
  p_notify_on_complete boolean default true,
  p_charge_credits boolean default false,
  p_credit_amount integer default null
) returns table (
  run_id uuid,
  attempt_id uuid,
  insufficient_credits boolean
)
language plpgsql
security definer
as $$
declare
  v_debit_result record;
begin
  if p_target_slide_count is null or p_target_slide_count < 1 or p_target_slide_count > 30 then
    raise exception 'target slide count must be between 1 and 30';
  end if;

  if p_author_model not in ('claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5') then
    raise exception 'author_model must be claude-sonnet-4-6, claude-opus-4-6, or claude-haiku-4-5';
  end if;

  if p_charge_credits and (p_credit_amount is null or p_credit_amount <= 0) then
    raise exception 'credit amount must be positive when charging credits';
  end if;

  -- Check and debit credits using FIFO from credit_grants
  if p_charge_credits then
    select * into v_debit_result
    from public.debit_credits_fifo(
      p_requested_by,
      p_credit_amount,
      'run_debit',
      p_run_id::text
    );

    if not v_debit_result.success then
      return query
      select null::uuid, null::uuid, true;
      return;
    end if;
  end if;

  insert into public.deck_runs (
    id,
    organization_id,
    project_id,
    requested_by,
    brief,
    business_context,
    client,
    audience,
    objective,
    thesis,
    stakes,
    source_file_ids,
    target_slide_count,
    author_model,
    template_profile_id,
    recipe_id,
    notify_on_complete,
    status,
    active_attempt_id,
    latest_attempt_id,
    latest_attempt_number
  ) values (
    p_run_id,
    p_organization_id,
    p_project_id,
    p_requested_by,
    coalesce(p_brief, '{}'::jsonb),
    coalesce(p_business_context, ''),
    coalesce(p_client, ''),
    coalesce(p_audience, 'Executive stakeholder'),
    coalesce(p_objective, ''),
    coalesce(p_thesis, ''),
    coalesce(p_stakes, ''),
    coalesce(p_source_file_ids, '{}'::uuid[]),
    p_target_slide_count,
    p_author_model,
    p_template_profile_id,
    p_recipe_id,
    coalesce(p_notify_on_complete, true),
    'queued',
    null,
    null,
    1
  );

  insert into public.deck_run_attempts (
    id,
    run_id,
    attempt_number,
    status
  ) values (
    p_attempt_id,
    p_run_id,
    1,
    'queued'
  );

  update public.deck_runs
  set
    active_attempt_id = p_attempt_id,
    latest_attempt_id = p_attempt_id
  where id = p_run_id;

  -- Note: debit_credits_fifo already wrote to credit_ledger for audit trail
  -- No need to insert into credit_ledger again here

  return query
  select p_run_id, p_attempt_id, false;
end;
$$;
