-- Card gift fees (2026-11-24):
--   platform_fee_usd_cents: The Wish List's 1%, paid by the giver (part of fee_usd_cents).
--   wisher_fee_usd_cents:   Stripe payout costs taken out of the gift before it's sent (0.25% + 25c, +$2 first payout of the month).
alter table public.purchases
  add column platform_fee_usd_cents int not null default 0 check (platform_fee_usd_cents >= 0),
  add column wisher_fee_usd_cents int not null default 0 check (wisher_fee_usd_cents >= 0);
