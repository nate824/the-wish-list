-- Stripe: giver pays the card fee on top; gifts are held on the platform then transferred.
alter table public.purchases
  add column fee_usd_cents int not null default 0 check (fee_usd_cents >= 0),  -- paid by giver, on top of amount
  add column stripe_transfer_id text unique,                                   -- null = held, not yet sent to wisher
  add column transferred_at timestamptz;
