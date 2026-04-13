create table if not exists public.service_idempotency_keys (
  id text primary key,
  scope text not null,
  status text not null default 'claimed' check (status in ('claimed', 'completed')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_service_idempotency_keys_scope_status
  on public.service_idempotency_keys (scope, status, created_at desc);

alter table public.service_idempotency_keys enable row level security;

create or replace function public.claim_service_idempotency_key(
  p_id text,
  p_scope text,
  p_metadata jsonb default '{}'::jsonb,
  p_stale_after_seconds integer default 900
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
begin
  insert into public.service_idempotency_keys (
    id,
    scope,
    status,
    metadata,
    created_at,
    updated_at
  )
  values (
    p_id,
    p_scope,
    'claimed',
    coalesce(p_metadata, '{}'::jsonb),
    v_now,
    v_now
  )
  on conflict (id) do update
    set scope = excluded.scope,
        status = 'claimed',
        metadata = excluded.metadata,
        updated_at = v_now,
        completed_at = null
    where public.service_idempotency_keys.status = 'claimed'
      and public.service_idempotency_keys.updated_at < v_now - make_interval(secs => greatest(p_stale_after_seconds, 0));

  return found;
end;
$$;

grant execute on function public.claim_service_idempotency_key(text, text, jsonb, integer) to service_role;
revoke all on function public.claim_service_idempotency_key(text, text, jsonb, integer) from public, anon, authenticated;
