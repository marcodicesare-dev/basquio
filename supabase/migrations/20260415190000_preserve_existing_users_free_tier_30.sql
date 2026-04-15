-- Preserve 30-credit free tier for accounts that already existed when this
-- migration is applied, even if they have not received their grant yet.
-- Only accounts created after the migration timestamp receive 15 credits.
do $migration$
declare
  v_cutoff timestamptz := now();
begin
  execute format($fn$
create or replace function public.grant_free_tier_credit_v2(
  p_user_id uuid
) returns boolean
language plpgsql
security definer
as $body$
declare
  v_user_created_at timestamptz;
  v_free_tier_amount integer;
  v_grant_inserted boolean := false;
begin
  select users.created_at
  into v_user_created_at
  from auth.users as users
  where users.id = p_user_id;

  if v_user_created_at is null then
    raise exception 'auth user not found for free-tier grant: %%', p_user_id;
  end if;

  if v_user_created_at < %L::timestamptz then
    v_free_tier_amount := 30;
  else
    v_free_tier_amount := 15;
  end if;

  insert into public.credit_grants (user_id, source, original_amount, remaining, expires_at)
  values (p_user_id, 'free_tier', v_free_tier_amount, v_free_tier_amount, '2099-12-31'::timestamptz)
  on conflict (user_id) where source = 'free_tier'
  do nothing;

  v_grant_inserted := found;

  insert into public.credit_ledger (user_id, amount, reason)
  values (p_user_id, v_free_tier_amount, 'free_tier')
  on conflict (user_id) where reason = 'free_tier'
  do nothing;

  return v_grant_inserted;
end;
$body$;
$fn$, v_cutoff);
end
$migration$;
