-- Wishes wait as private drafts until the wisher gives.
-- Anyone signed in can save one wish. It goes live (status 'open') when:
--   * they already have an unused verified gift, or an unused Founding 100 pass (immediately), or
--   * one of their gifts is verified later (automatically, in the purchase trigger below).

alter type public.wish_status add value if not exists 'draft' before 'open';

-- post_wish: never refuses for the gate any more; it saves a draft instead.
create or replace function public.post_wish(
  p_title text,
  p_description text,
  p_price_usd_cents int,
  p_is_anonymous boolean,
  p_btc_address text,
  p_lightning_address text,
  p_accepts_stripe boolean
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  credit uuid;
  founding boolean := false;
  publish boolean;
  new_id uuid;
  min_price int;
begin
  if uid is null then raise exception 'Sign in first'; end if;

  select min_wish_price_cents into min_price from app_settings;
  if p_price_usd_cents < min_price then
    raise exception 'Minimum wish price is $%', min_price / 100.0;
  end if;

  select p.id into credit
    from purchases p, app_settings s
    where p.buyer_id = uid and p.status = 'verified'
      and p.consumed_by_wish_id is null
      and p.amount_usd_cents >= s.min_gate_purchase_cents
    order by p.verified_at
    limit 1
    for update of p skip locked;

  if credit is null then
    select true into founding from profiles
      where user_id = uid and is_founding_member and not founding_pass_used
      for update;
    founding := coalesce(founding, false);
  end if;

  publish := credit is not null or founding;

  if not publish and exists (select 1 from wishes where user_id = uid and status = 'draft') then
    raise exception 'DRAFT_EXISTS: you already have a wish waiting. Fund someone''s wish to publish it.';
  end if;

  insert into wishes (user_id, title, description, price_usd_cents, is_anonymous,
                      btc_address, lightning_address, accepts_stripe, used_founding_pass, status)
  values (uid, p_title, nullif(p_description, ''), p_price_usd_cents, p_is_anonymous,
          nullif(p_btc_address, ''), nullif(p_lightning_address, ''),
          coalesce(p_accepts_stripe, false), founding,
          case when publish then 'open' else 'draft' end::wish_status)
  returning id into new_id;

  if credit is not null then
    update purchases set consumed_by_wish_id = new_id where id = credit;
  elsif founding then
    update profiles set founding_pass_used = true where user_id = uid;
  end if;

  return new_id;
end $$;

-- Verified gift: fund the wish, then publish the giver's oldest draft (spending this gift as the credit).
create or replace function public.on_purchase_verified()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  draft_id uuid;
begin
  if new.status = 'verified' and (old.status is distinct from 'verified') then
    new.verified_at := coalesce(new.verified_at, now());
    update wishes set status = 'funded', funded_at = now()
      where id = new.wish_id and status = 'open';

    if new.consumed_by_wish_id is null
       and new.amount_usd_cents >= (select min_gate_purchase_cents from app_settings) then
      select id into draft_id from wishes
        where user_id = new.buyer_id and status = 'draft'
        order by created_at limit 1
        for update;
      if draft_id is not null then
        -- created_at restarts so the feed's "oldest first" counts from when it went live
        update wishes set status = 'open', created_at = now() where id = draft_id;
        new.consumed_by_wish_id := draft_id;
      end if;
    end if;
  end if;
  return new;
end $$;

revoke execute on function public.on_purchase_verified() from public, anon, authenticated;
grant execute on function public.post_wish(text, text, int, boolean, text, text, boolean) to authenticated;
