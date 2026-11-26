-- Pooled gifts and giver ranking (Nate, 2026-11-25). Run AFTER 0008_pledge_statuses has been applied on its own.
--
--   * Wishes always post. No give-to-get gate, no drafts. Existing drafts go live.
--   * Anyone can chip in any amount (min $5, or whatever is left). A wish is funded when the
--     money actually collected reaches its price.
--   * Bitcoin / Lightning chip-ins go wallet to wallet straight away (we never hold them).
--   * Card chip-ins are PLEDGES: the card is saved, and charged only once collected + pledged
--     covers the price. We never hold card money waiting for a wish to fill.
--   * The first pledge starts a funding window (14 days). If the wish isn't covered by then,
--     every pledge expires and nobody's card is charged. The next pledge starts a new window.
--   * Feed rank = the wisher's giving score (desc), then oldest first.
--     Score = 1 point per wish you've helped fund + 1 point per $25 given. Only money that
--     actually moved counts (verified crypto, charged cards), so unpaid pledges can't game it.
--   * Wish price cap $500, max 3 open wishes per person (both tunable in app_settings).

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
alter table public.app_settings
  add column if not exists max_wish_price_cents int not null default 50000,
  add column if not exists min_contribution_cents int not null default 500,
  add column if not exists pledge_window_days int not null default 14,
  add column if not exists score_points_per_wish int not null default 1,
  add column if not exists score_cents_per_point int not null default 2500,
  add column if not exists max_open_wishes int not null default 3;     -- replaces the old gate as a spam brake

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table public.wishes
  add column if not exists collected_usd_cents int not null default 0,  -- verified money (crypto + charged cards)
  add column if not exists pledged_usd_cents int not null default 0,    -- saved cards not yet charged
  add column if not exists funding_deadline timestamptz;                -- set by the first pledge of a round

alter table public.profiles
  add column if not exists giving_score int not null default 0,
  add column if not exists wishes_helped int not null default 0,
  add column if not exists given_usd_cents bigint not null default 0,
  add column if not exists stripe_customer_id text unique;              -- giver side, for saved cards

alter table public.purchases
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_payment_method_id text,
  add column if not exists stripe_setup_intent_id text unique,
  add column if not exists charge_failed_at timestamptz,               -- off-session charge declined
  add column if not exists card_released_at timestamptz;               -- saved card detached after expiry

-- Many verified chip-ins per wish now.
drop index if exists public.purchases_one_verified_per_wish;

create index if not exists purchases_pledges_idx on public.purchases (wish_id)
  where status in ('pledged', 'charging');

-- ---------------------------------------------------------------------------
-- Funding totals and giver score (kept on the rows so the feed can sort cheaply)
-- ---------------------------------------------------------------------------
create or replace function public.refresh_wish_funding(p_wish_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  got int;
  promised int;
  window_days int;
begin
  select coalesce(sum(amount_usd_cents) filter (where status = 'verified'), 0),
         coalesce(sum(amount_usd_cents) filter (where status in ('pledged', 'charging')), 0)
    into got, promised
    from purchases where wish_id = p_wish_id;
  select pledge_window_days into window_days from app_settings;

  update wishes set
    collected_usd_cents = got,
    pledged_usd_cents = promised,
    funding_deadline = case
      when promised = 0 then null
      when funding_deadline is null then now() + make_interval(days => window_days)
      else funding_deadline end,
    status = case when status = 'open' and got >= price_usd_cents then 'funded'::wish_status else status end,
    funded_at = case when status = 'open' and got >= price_usd_cents then now() else funded_at end
  where id = p_wish_id;
end $$;

create or replace function public.refresh_giver_score(p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  helped int;
  given bigint;
  s app_settings%rowtype;
begin
  select * into s from app_settings;
  select count(distinct wish_id), coalesce(sum(amount_usd_cents), 0)
    into helped, given
    from purchases where buyer_id = p_user_id and status = 'verified';
  update profiles set
    wishes_helped = helped,
    given_usd_cents = given,
    giving_score = helped * s.score_points_per_wish + (given / greatest(s.score_cents_per_point, 1))::int
  where user_id = p_user_id;
end $$;

create or replace function public.on_purchase_changed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform refresh_wish_funding(new.wish_id);
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    perform refresh_giver_score(new.buyer_id);
  end if;
  return null;
end $$;

drop trigger if exists purchases_changed on public.purchases;
create trigger purchases_changed
  after insert or update of status, amount_usd_cents on public.purchases
  for each row execute function public.on_purchase_changed();

-- The BEFORE trigger now only stamps verified_at. Funding is decided by the totals above,
-- and drafts no longer exist.
create or replace function public.on_purchase_verified()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'verified' and (old.status is distinct from 'verified') then
    new.verified_at := coalesce(new.verified_at, now());
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Posting: always live, price between min and the cap
-- ---------------------------------------------------------------------------
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
  s app_settings%rowtype;
  new_id uuid;
begin
  if uid is null then raise exception 'Sign in first'; end if;
  select * into s from app_settings;
  if p_price_usd_cents < s.min_wish_price_cents then
    raise exception 'Minimum wish price is $%', s.min_wish_price_cents / 100;
  end if;
  if p_price_usd_cents > s.max_wish_price_cents then
    raise exception 'PRICE_CAP: wishes can be up to $% for now', s.max_wish_price_cents / 100;
  end if;
  if (select count(*) from wishes where user_id = uid and status = 'open') >= s.max_open_wishes then
    raise exception 'OPEN_LIMIT: you can have % open wishes at a time', s.max_open_wishes;
  end if;

  insert into wishes (user_id, title, description, price_usd_cents, is_anonymous,
                      btc_address, lightning_address, accepts_stripe, status)
  values (uid, p_title, nullif(p_description, ''), p_price_usd_cents, p_is_anonymous,
          nullif(p_btc_address, ''), nullif(p_lightning_address, ''),
          coalesce(p_accepts_stripe, false), 'open')
  returning id into new_id;
  return new_id;
end $$;

create or replace function public.can_post_wish()
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null;
$$;

-- Price and chip-in limits for forms.
create or replace function public.wish_limits()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'min_price_cents', min_wish_price_cents,
    'max_price_cents', max_wish_price_cents,
    'min_contribution_cents', min_contribution_cents,
    'pledge_window_days', pledge_window_days)
  from app_settings;
$$;

-- ---------------------------------------------------------------------------
-- Pledges (server only)
-- ---------------------------------------------------------------------------
-- Records a saved-card pledge. Locks the wish so two givers can't over-pledge the last dollars.
-- Idempotent on the SetupIntent. A chip-in must be at least the minimum, unless it covers
-- everything that's left.
create or replace function public.add_pledge(
  p_wish_id uuid, p_buyer_id uuid, p_amount int, p_fee int, p_platform_fee int,
  p_customer text, p_payment_method text, p_setup_intent text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  w wishes%rowtype;
  existing uuid;
  remaining int;
  min_c int;
  new_id uuid;
begin
  select id into existing from purchases where stripe_setup_intent_id = p_setup_intent;
  if existing is not null then return existing; end if;

  select * into w from wishes where id = p_wish_id for update;
  if not found then raise exception 'Wish not found'; end if;
  if w.status <> 'open' then raise exception 'FILLED: this wish is already funded'; end if;
  remaining := w.price_usd_cents - w.collected_usd_cents - w.pledged_usd_cents;
  select min_contribution_cents into min_c from app_settings;
  if remaining <= 0 then raise exception 'FILLED: this wish is already fully pledged'; end if;
  if p_amount > remaining then raise exception 'TOO_MUCH: only $% is left on this wish', remaining / 100.0; end if;
  if p_amount < least(min_c, remaining) then raise exception 'TOO_LITTLE: the minimum chip-in is $%', min_c / 100; end if;

  insert into purchases (wish_id, buyer_id, rail, status, amount_usd_cents, fee_usd_cents, platform_fee_usd_cents,
                         stripe_customer_id, stripe_payment_method_id, stripe_setup_intent_id)
  values (p_wish_id, p_buyer_id, 'stripe', 'pledged', p_amount, p_fee, p_platform_fee,
          p_customer, p_payment_method, p_setup_intent)
  returning id into new_id;
  return new_id;
end $$;

-- Expires pledges on wishes whose window ran out without being covered. Cards are never charged.
-- Safe to call from anywhere, any time (pages call it lazily; a cron can too).
create or replace function public.expire_stale_pledges()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update purchases p set status = 'expired', review_note = 'funding window ended before the wish was covered'
    from wishes w
    where w.id = p.wish_id and p.status = 'pledged'
      and w.funding_deadline < now()
      and w.collected_usd_cents + w.pledged_usd_cents < w.price_usd_cents;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Public feed view: add funding progress and the wisher's giving score (appended columns only)
-- ---------------------------------------------------------------------------
create or replace view public.public_wishes as
  select w.id, w.title, w.description, w.price_usd_cents, w.tier, w.status,
         w.created_at, w.funded_at, w.is_anonymous,
         case when w.is_anonymous then null else p.display_name end as display_name,
         case when w.is_anonymous then null else p.bio end as bio,
         case when w.is_anonymous then null else p.photo_url end as photo_url,
         w.btc_address, w.lightning_address, w.accepts_stripe,
         w.collected_usd_cents, w.pledged_usd_cents, w.funding_deadline,
         p.giving_score as owner_score
  from wishes w join profiles p on p.user_id = w.user_id
  where w.status in ('open', 'funded');

grant select on public.public_wishes to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on function public.refresh_wish_funding(uuid) from public, anon, authenticated;
revoke execute on function public.refresh_giver_score(uuid) from public, anon, authenticated;
revoke execute on function public.on_purchase_changed() from public, anon, authenticated;
revoke execute on function public.add_pledge(uuid, uuid, int, int, int, text, text, text) from public, anon, authenticated;
grant execute on function public.add_pledge(uuid, uuid, int, int, int, text, text, text) to service_role;
revoke execute on function public.expire_stale_pledges() from public;
grant execute on function public.expire_stale_pledges() to anon, authenticated, service_role;
revoke execute on function public.wish_limits() from public;
grant execute on function public.wish_limits() to anon, authenticated;
grant execute on function public.post_wish(text, text, int, boolean, text, text, boolean) to authenticated;
grant execute on function public.can_post_wish() to authenticated;

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------
-- Drafts go live, with their clock starting now.
update public.wishes set status = 'open', created_at = now() where status = 'draft';

select public.refresh_wish_funding(id) from public.wishes;
select public.refresh_giver_score(user_id) from public.profiles;
