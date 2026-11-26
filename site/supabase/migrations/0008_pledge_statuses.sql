-- Pooled gifts, part 1 of 2. Run this file ON ITS OWN, before 0009.
-- Postgres won't let a new enum value be used in the same transaction that adds it.
--
--   pledged  : card saved (SetupIntent), not charged. Charged only when the wish is fully funded.
--   charging : off-session charge in flight (also the lock that stops a pledge being charged twice).
--   expired  : the wish's funding deadline passed before it filled. Card never charged.

alter type public.purchase_status add value if not exists 'pledged';
alter type public.purchase_status add value if not exists 'charging';
alter type public.purchase_status add value if not exists 'expired';
