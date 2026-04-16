-- Restore the free tier to 30 credits for all future grants.
-- Also top up users who received a 15-credit free-tier grant during the temporary window.
create or replace function public.grant_free_tier_credit_v2(
  p_user_id uuid
) returns boolean
language plpgsql
security definer
as $$
declare
  v_grant_inserted boolean := false;
begin
  insert into public.credit_grants (user_id, source, original_amount, remaining, expires_at)
  values (p_user_id, 'free_tier', 30, 30, '2099-12-31'::timestamptz)
  on conflict (user_id) where source = 'free_tier'
  do nothing;

  v_grant_inserted := found;

  insert into public.credit_ledger (user_id, amount, reason)
  values (p_user_id, 30, 'free_tier')
  on conflict (user_id) where reason = 'free_tier'
  do nothing;

  return v_grant_inserted;
end;
$$;

create temporary table temp_free_tier_restore_users on commit drop as
select user_id
from public.credit_grants
where source = 'free_tier'
  and original_amount = 15;

with affected_users as (
  select user_id
  from temp_free_tier_restore_users
)
update public.credit_grants as grants
set
  original_amount = 30,
  remaining = grants.remaining + 15
where grants.source = 'free_tier'
  and grants.user_id in (select user_id from affected_users);

with affected_users as (
  select user_id
  from temp_free_tier_restore_users
)
update public.credit_ledger as ledger
set amount = 30
where ledger.reason = 'free_tier'
  and ledger.amount = 15
  and ledger.user_id in (select user_id from affected_users);
