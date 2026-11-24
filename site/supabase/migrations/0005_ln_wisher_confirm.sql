-- Lightning fallback for addresses without LUD-21 verify (e.g. Strike):
-- buyer taps "I paid", wisher taps "I got it". Guards against sock-puppet accounts:
-- suspicious confirmations go to the admin review queue instead of verifying.
-- Decided by Nate 2026-11-23 (see lnurl-checklist.md).

alter table public.purchases
  add column ln_confirm_mode text check (ln_confirm_mode in ('verify', 'wisher')),
  add column buyer_ip inet,
  add column paid_claimed_at timestamptz,
  add column wisher_confirmed_at timestamptz,
  add column wisher_ip inet;

create index purchases_ln_awaiting_idx on public.purchases (wish_id)
  where rail = 'lightning' and ln_confirm_mode = 'wisher' and status = 'pending';

-- Tunables
create or replace function public.ln_confirm_min_account_age() returns interval
  language sql immutable as $$ select interval '3 days' $$;
create or replace function public.ln_confirm_max_new_buyers() returns int
  language sql immutable as $$ select 2 $$;

-- Called from the server (service role) after it has checked the caller owns the wish.
-- Returns the purchase's new status: 'verified', 'review' or 'rejected'.
create or replace function public.confirm_ln_gift(
  p_purchase_id uuid, p_wisher_id uuid, p_received boolean, p_wisher_ip inet
) returns public.purchase_status
language plpgsql security definer set search_path = public as $$
declare
  p purchases%rowtype;
  w wishes%rowtype;
  wisher_created timestamptz;
  buyer_created timestamptz;
  new_buyer_confirms int;
  reasons text[] := '{}';
  result purchase_status;
begin
  select * into p from purchases where id = p_purchase_id for update;
  if not found then raise exception 'Purchase not found'; end if;
  select * into w from wishes where id = p.wish_id;
  if w.user_id <> p_wisher_id then raise exception 'Not your wish'; end if;
  if p.rail <> 'lightning' or p.ln_confirm_mode <> 'wisher' then raise exception 'This gift confirms automatically'; end if;
  if p.status <> 'pending' then return p.status; end if;

  if not p_received then
    update purchases set status = 'rejected', wisher_confirmed_at = now(), wisher_ip = p_wisher_ip,
      review_note = 'wisher: not received' where id = p.id;
    return 'rejected';
  end if;

  select created_at into wisher_created from auth.users where id = p_wisher_id;
  select created_at into buyer_created from auth.users where id = p.buyer_id;

  if wisher_created > now() - ln_confirm_min_account_age() then
    reasons := array_append(reasons, 'wisher account is new');
  end if;
  if p.buyer_ip is not null and p_wisher_ip is not null and p.buyer_ip = p_wisher_ip then
    reasons := array_append(reasons, 'same IP as buyer');
  end if;
  -- reciprocal pair: wisher has funded a wish owned by this buyer
  if exists (select 1 from purchases q join wishes w2 on w2.id = q.wish_id
             where q.buyer_id = p_wisher_id and w2.user_id = p.buyer_id and q.status = 'verified') then
    reasons := array_append(reasons, 'buyer and wisher fund each other');
  end if;
  if buyer_created > now() - ln_confirm_min_account_age() then
    select count(*) into new_buyer_confirms
    from purchases q join wishes w2 on w2.id = q.wish_id join auth.users u on u.id = q.buyer_id
    where w2.user_id = p_wisher_id and q.ln_confirm_mode = 'wisher' and q.status = 'verified'
      and u.created_at > q.created_at - ln_confirm_min_account_age();
    if new_buyer_confirms >= ln_confirm_max_new_buyers() then
      reasons := array_append(reasons, 'wisher already confirmed several gifts from new accounts');
    end if;
  end if;

  result := case when cardinality(reasons) = 0 then 'verified' else 'review' end;
  update purchases set
    status = result,
    settled_at = now(),
    verified_at = case when result = 'verified' then now() end,
    wisher_confirmed_at = now(),
    wisher_ip = p_wisher_ip,
    review_note = case when result = 'review' then 'wisher-confirmed LN: ' || array_to_string(reasons, ', ') end
  where id = p.id;
  return result;
end $$;

revoke all on function public.confirm_ln_gift(uuid, uuid, boolean, inet) from public, anon, authenticated;
grant execute on function public.confirm_ln_gift(uuid, uuid, boolean, inet) to service_role;
