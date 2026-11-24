-- Stripe Connect: one connected account per wisher (Accounts v2, recipient configuration).
-- Card gifts sit in the platform's Stripe balance until the wisher can receive transfers.
alter table public.profiles
  add column stripe_account_id text unique,
  add column stripe_transfers_active boolean not null default false;

-- Find held card gifts quickly (verified, not yet sent to the wisher).
create index purchases_stripe_held_idx
  on public.purchases (wish_id)
  where rail = 'stripe' and status = 'verified' and stripe_transfer_id is null;

-- No grant needed: 0001 only lets users update display_name, bio, photo_url, is_anonymous,
-- so only the service role can write these two columns.
