-- The Wish List: initial schema
-- Give-to-get gate, Founding 100, wishes, purchases (btc | lightning | stripe), thank-yous.
-- The posting gate is enforced HERE (post_wish function + RLS), not only in the UI.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Settings (single row). Tune without a redeploy.
-- ---------------------------------------------------------------------------
create table public.app_settings (
  id boolean primary key default true check (id),
  min_gate_purchase_cents int not null default 500,   -- $5 counts toward the gate
  min_wish_price_cents int not null default 500
);
insert into public.app_settings default values;

-- ---------------------------------------------------------------------------
-- Profiles (1:1 with auth.users, created by trigger)
-- ---------------------------------------------------------------------------
create table public.profiles (
  user_id uuid primary key references auth.users on delete cascade,
  display_name text check (char_length(display_name) <= 60),
  bio text check (char_length(bio) <= 280),
  photo_url text,
  is_anonymous boolean not null default true,
  is_founding_member boolean not null default false,
  founding_claimed_at timestamptz,
  founding_pass_used boolean not null default false,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Founding 100: single-row counter, atomic claim
-- ---------------------------------------------------------------------------
create table public.founding_counter (
  id boolean primary key default true check (id),
  claimed int not null default 0,
  cap int not null default 100
);
insert into public.founding_counter default values;

-- Called once after the user's first verified sign-in. Idempotent.
create or replace function public.claim_founding_spot()
returns boolean language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  already boolean;
  got int;
begin
  if uid is null then return false; end if;

  select is_founding_member or founding_claimed_at is not null
    into already from profiles where user_id = uid for update;
  if already then
    return (select is_founding_member from profiles where user_id = uid);
  end if;

  -- atomic: a rush of signups cannot push past cap
  update founding_counter set claimed = claimed + 1
    where claimed < cap
    returning claimed into got;

  if got is null then
    -- mark as "checked" so we don't retry forever
    update profiles set founding_claimed_at = now() where user_id = uid;
    return false;
  end if;

  update profiles
    set is_founding_member = true, founding_claimed_at = now()
    where user_id = uid;
  return true;
end $$;

create or replace function public.founding_spots_left()
returns int language sql stable security definer set search_path = public as $$
  select greatest(cap - claimed, 0) from founding_counter;
$$;

-- ---------------------------------------------------------------------------
-- Wishes
-- ---------------------------------------------------------------------------
create type public.wish_status as enum ('open', 'funded', 'cancelled');

create table public.wishes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  title text not null check (char_length(title) between 3 and 120),
  description text check (char_length(description) <= 1000),
  price_usd_cents int not null check (price_usd_cents > 0),
  tier text generated always as (
    case when price_usd_cents < 2500 then 'small'
         when price_usd_cents <= 10000 then 'mid'
         else 'big' end
  ) stored,
  is_anonymous boolean not null default true,
  status public.wish_status not null default 'open',
  btc_address text,
  lightning_address text,
  accepts_stripe boolean not null default false,
  stripe_account_id text,
  used_founding_pass boolean not null default false,
  created_at timestamptz not null default now(),
  funded_at timestamptz,
  constraint has_payout check (
    btc_address is not null or lightning_address is not null or accepts_stripe
  )
);

create index wishes_feed_idx on public.wishes (tier, created_at) where status = 'open';

-- ---------------------------------------------------------------------------
-- Purchases (one record per payment attempt, any rail)
-- ---------------------------------------------------------------------------
create type public.purchase_rail as enum ('btc', 'lightning', 'stripe');
create type public.purchase_status as enum ('pending', 'verified', 'rejected', 'review');

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  wish_id uuid not null references public.wishes on delete cascade,
  buyer_id uuid not null references auth.users on delete cascade,
  rail public.purchase_rail not null,
  amount_usd_cents int not null check (amount_usd_cents > 0),
  status public.purchase_status not null default 'pending',
  quoted_at timestamptz not null default now(),
  nonce text not null default encode(gen_random_bytes(8), 'hex'),
  -- btc
  txid text unique,
  sender_address text,
  signed_message text,
  signature text,
  btc_amount_sats bigint,
  -- lightning
  ln_invoice text,
  ln_verify_url text,
  ln_payment_hash text unique,
  settled_at timestamptz,
  -- stripe
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text,
  -- gate bookkeeping: the wish this purchase unlocked (one purchase -> one post)
  consumed_by_wish_id uuid unique references public.wishes on delete set null,
  review_note text,
  created_at timestamptz not null default now(),
  verified_at timestamptz
);

create index purchases_buyer_idx on public.purchases (buyer_id, status);
-- one verified payment per wish
create unique index purchases_one_verified_per_wish
  on public.purchases (wish_id) where status = 'verified';

-- Buyer cannot fund their own wish.
create or replace function public.check_not_self_purchase()
returns trigger language plpgsql as $$
begin
  if exists (select 1 from wishes w where w.id = new.wish_id and w.user_id = new.buyer_id) then
    raise exception 'You cannot fund your own wish';
  end if;
  return new;
end $$;

create trigger purchases_not_self
  before insert or update of buyer_id, wish_id on public.purchases
  for each row execute function public.check_not_self_purchase();

-- When a purchase becomes verified, the wish is funded and leaves the feed.
create or replace function public.on_purchase_verified()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'verified' and (old.status is distinct from 'verified') then
    new.verified_at := coalesce(new.verified_at, now());
    update wishes set status = 'funded', funded_at = now()
      where id = new.wish_id and status = 'open';
  end if;
  return new;
end $$;

create trigger purchases_verified
  before update of status on public.purchases
  for each row execute function public.on_purchase_verified();

-- ---------------------------------------------------------------------------
-- Give-to-get gate
-- ---------------------------------------------------------------------------
create or replace function public.can_post_wish()
returns boolean language sql stable security definer set search_path = public as $$
  with me as (select auth.uid() as uid)
  select exists (
      select 1 from purchases p, app_settings s
      where p.buyer_id = (select uid from me) and p.status = 'verified'
        and p.consumed_by_wish_id is null
        and p.amount_usd_cents >= s.min_gate_purchase_cents
    )
    or exists (
      select 1 from profiles
      where user_id = (select uid from me) and is_founding_member and not founding_pass_used
    );
$$;

-- The ONLY way to create a wish. Checks the gate and consumes the credit atomically.
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
  new_id uuid;
  min_price int;
begin
  if uid is null then raise exception 'Sign in first'; end if;

  select min_wish_price_cents into min_price from app_settings;
  if p_price_usd_cents < min_price then
    raise exception 'Minimum wish price is $%', min_price / 100.0;
  end if;

  -- prefer spending a purchase credit; keep founding pass for later only if no credit
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
    if not coalesce(founding, false) then
      raise exception 'GATE: fund someone else''s wish first';
    end if;
  end if;

  insert into wishes (user_id, title, description, price_usd_cents, is_anonymous,
                      btc_address, lightning_address, accepts_stripe, used_founding_pass)
  values (uid, p_title, nullif(p_description, ''), p_price_usd_cents, p_is_anonymous,
          nullif(p_btc_address, ''), nullif(p_lightning_address, ''),
          coalesce(p_accepts_stripe, false), credit is null)
  returning id into new_id;

  if credit is not null then
    update purchases set consumed_by_wish_id = new_id where id = credit;
  else
    update profiles set founding_pass_used = true where user_id = uid;
  end if;

  return new_id;
end $$;

-- ---------------------------------------------------------------------------
-- Thank-you notes
-- ---------------------------------------------------------------------------
create table public.thank_yous (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null unique references public.purchases on delete cascade,
  from_user_id uuid not null references auth.users on delete cascade,
  message text not null check (char_length(message) between 1 and 1000),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Public feed view (hides user_id; shows name/bio only if not anonymous)
-- Views run with owner rights, so they bypass RLS by design: expose only safe columns.
-- ---------------------------------------------------------------------------
create view public.public_wishes as
  select w.id, w.title, w.description, w.price_usd_cents, w.tier, w.status,
         w.created_at, w.funded_at, w.is_anonymous,
         case when w.is_anonymous then null else p.display_name end as display_name,
         case when w.is_anonymous then null else p.bio end as bio,
         case when w.is_anonymous then null else p.photo_url end as photo_url,
         w.btc_address, w.lightning_address, w.accepts_stripe
  from wishes w join profiles p on p.user_id = w.user_id
  where w.status in ('open', 'funded');

grant select on public.public_wishes to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.wishes enable row level security;
alter table public.purchases enable row level security;
alter table public.thank_yous enable row level security;
alter table public.founding_counter enable row level security;
alter table public.app_settings enable row level security;

-- profiles: read/update own; only safe columns are updatable
create policy "own profile read" on public.profiles for select using (user_id = auth.uid());
create policy "own profile update" on public.profiles for update using (user_id = auth.uid());
revoke update on public.profiles from authenticated, anon;
grant update (display_name, bio, photo_url, is_anonymous) on public.profiles to authenticated;

-- wishes: owners read their own (public reads go through public_wishes).
-- NO insert policy: wishes are created only through post_wish().
create policy "own wishes read" on public.wishes for select using (user_id = auth.uid());
create policy "own wishes update" on public.wishes for update using (user_id = auth.uid());
revoke insert, update, delete on public.wishes from authenticated, anon;
grant update (title, description, is_anonymous) on public.wishes to authenticated;

-- purchases: buyer and wisher can read. Writes happen server-side (service role) after verification.
create policy "buyer or wisher read" on public.purchases for select using (
  buyer_id = auth.uid()
  or exists (select 1 from wishes w where w.id = wish_id and w.user_id = auth.uid())
);
revoke insert, update, delete on public.purchases from authenticated, anon;

-- thank-yous: wisher writes for a verified purchase on their own wish; buyer and wisher read
create policy "thank you write" on public.thank_yous for insert with check (
  from_user_id = auth.uid()
  and exists (
    select 1 from purchases p join wishes w on w.id = p.wish_id
    where p.id = purchase_id and p.status = 'verified' and w.user_id = auth.uid()
  )
);
create policy "thank you read" on public.thank_yous for select using (
  from_user_id = auth.uid()
  or exists (select 1 from purchases p where p.id = purchase_id and p.buyer_id = auth.uid())
);

-- counter and settings: no direct access; use the functions above.
-- Postgres grants EXECUTE to PUBLIC by default, so lock down first.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.founding_spots_left() to anon, authenticated;
grant execute on function public.claim_founding_spot() to authenticated;
grant execute on function public.can_post_wish() to authenticated;
grant execute on function public.post_wish(text, text, int, boolean, text, text, boolean) to authenticated;
