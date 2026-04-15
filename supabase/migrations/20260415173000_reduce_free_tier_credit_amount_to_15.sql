-- Reduce free tier grant amount for new users: 30 -> 15.
-- Preserve existing users exactly as they are today.
create or replace function public.grant_free_tier_credit_v2(
  p_user_id uuid
) returns boolean
language plpgsql
security definer
as $$
begin
  insert into public.credit_grants (user_id, source, original_amount, remaining, expires_at)
  values (p_user_id, 'free_tier', 15, 15, '2099-12-31'::timestamptz)
  on conflict (user_id) where source = 'free_tier'
  do nothing;

  insert into public.credit_ledger (user_id, amount, reason)
  values (p_user_id, 15, 'free_tier')
  on conflict (user_id) where reason = 'free_tier'
  do nothing;

  return found;
end;
$$;
