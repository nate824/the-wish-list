# Decisions and guesses (v0.1)

Marked so Nate can overrule. Each is a one-line change unless noted.

1. **Minimum wish price $5**, same as the gate minimum. So every gift counts toward the gate. (`app_settings`)
2. **One gift = one post.** Each verified purchase unlocks exactly one wish (`consumed_by_wish_id`). The founding pass is a separate one-time credit; a purchase credit is spent first if you have both.
3. **Founding spot is claimed on first successful magic-link sign-in**, not on page visit. Once full, later users are marked "checked" and never retry.
4. **Feed page = 4 oldest per tier, shuffled** (12 cards on "All"). Single-tier views show 12, oldest first, no shuffle.
5. **BTC: 0-conf accepted** once the tx pays the address and the signature checks out. Admins can still reject. Plan suggested 1 conf; easy to switch (`confirmed` is returned by the check).
6. **BTC tolerance 3%, quote locked 15 min** (plan default).
7. **Wish is "funded" by one verified full payment.** Partial/crowd funding is out for v1.
8. **Public feed reads go through a view** (`public_wishes`) that hides user ids and shows name/bio only on named wishes.
9. **Lightning is built but kept visually light** until we know which big wallets support LUD-21 (see `lnurl-checklist.md`). Wishes with a Lightning address that fails verify are rejected at save time.
10. **Stripe left as a stub**; card option shows "coming soon". Design is set (Nate, 2026-11-23):
    - **Giver pays the card fee on top.** Wisher gets the full price; the platform never covers fees. `giverTotal()` in `src/lib/payments/stripe.ts` (e.g. $50 wish -> $51.80). Base US rate only (2.9% + 30¢, a guess until the account's real pricing is confirmed).
    - **Separate charges and transfers**, not destination charges. Gift is held in the platform's Stripe balance and transferred once the wisher finishes Express onboarding. The platform is merchant of record, so refunds and disputes land on the platform account.
    - Schema ready: `0002_stripe_fees.sql` adds `fee_usd_cents`, `stripe_transfer_id`, `transferred_at`.
11. **Site name "The Wish List"** is a placeholder until a name/domain is picked.
12. **Supabase sends the magic-link emails** for now; Resend comes in with notifications.
13. **Stripe: separate charges and transfers, not destination charges.** Stripe's planner said so because wishers set up payouts after their first gift, so funds must be held. Platform is merchant of record (refunds and disputes hit the platform balance).
14. **Giver pays the card fee** (Nate, 2026-11-23): grossed up to 2.9% + 30c, so a $50 wish costs $51.81. Non-US cards also pay Stripe's 1.5% international fee (Nate, 2026-11-23), so a $50 wish costs $52.62 on a foreign card. See the card-country decision below.
15. **One connected account per wisher** (`profiles.stripe_account_id`), not per wish. `wishes.stripe_account_id` is unused.
16. **Double-funded card gift** (two givers pay at once): the second payment goes to the admin review queue with a note to refund it in Stripe.
13. **Wishes wait as private drafts until you give** (Nate, 2026-11-23). Anyone signed in can write and save one wish. It goes live automatically the moment one of their gifts is verified (any rail), and its "waiting since" clock starts then. One draft at a time. Founding 100 members still go live immediately on their first wish. Migration `0004_draft_wishes.sql`.

## Lightning without LUD-21 verify (2026-11-23, Nate)
- Tested: Coinos supports verify (full loop proven with Phoenix as sender); Strike does not.
- Addresses without verify are accepted. Buyer taps "I've paid", wisher confirms on /gifts.
- Guards in `confirm_ln_gift()` (0005): wisher account < 3 days old, same IP as buyer, reciprocal funding pair,
  or > 2 confirmed gifts from new (< 3 day) buyer accounts -> goes to /admin review instead of verified.
- Verify-mode payments also check sha256(preimage) == payment hash when the provider returns a preimage.
17. **Foreign card fee only when the card is foreign** (Nate, 2026-11-23). Card gifts moved from hosted Checkout to the Payment Element on the wish page, because Checkout fixes the amount before we can see the card. The page makes a ConfirmationToken, the server reads the card's issuing country, and non-US cards add 1.5%. If the total changes, the giver sees the new total and presses pay again; nobody is charged more than they were shown. No currency-conversion fee applies, since we charge and settle in USD. Unknown country counts as US. `/api/stripe/checkout` is retired (410).

## Pooled gifts and giver ranking (Nate, 2026-11-25). Replaces the give-to-get gate and drafts (#2, #7, #13).
Migrations `0008_pledge_statuses.sql` (run alone first) and `0009_pooled_gifts.sql`.
18. **Wishes always post.** No gate, no drafts (existing drafts go live). Spam brake: max 3 open wishes per person (`app_settings.max_open_wishes`). GUESS, easy to change.
19. **Price cap $500** (`app_settings.max_wish_price_cents`). Raise it once completion rates are known.
20. **Anyone can chip in any amount**, min $5 (or whatever's left), never more than what's left. A wish is funded when verified money reaches its price.
21. **Card chip-ins are pledges.** Card saved with a SetupIntent, charged off-session only once verified money + pledges cover the price. No held money, no refunds. The chip-in that covers the rest charges everyone right away.
22. **Funding window 14 days**, started by the first pledge (`pledge_window_days`). If not covered, pledges expire, cards are detached, nobody is charged. Next pledge starts a new window. Expiry runs lazily on page loads plus `/api/cron/pledges` (needs `CRON_SECRET` and a scheduler).
23. **Bitcoin / Lightning chip-ins go to the wisher immediately** and can't be returned, even if the wish never fills. The UI says so.
24. **Declined card at the end:** pledges already charged still go to the wisher; the declined one is dropped and the gap reopens. The giver sees a notice on the wish page. No email yet (Resend not wired).
25. **Giving score** = 1 point per wish helped + 1 point per $25 given (`score_points_per_wish`, `score_cents_per_point`). Only verified money counts (crypto verified, cards charged); open pledges don't, so they can't be gamed. Lightning counts like any other rail.
26. **Feed rank** = wisher's giving score, then oldest first. Tier slices kept; "All" no longer shuffles.
27. **Wisher payout fee on pooled wishes:** 0.25% per transfer, the fixed 25c once per wish (not per chip-in).
28. **Founding 100** no longer does anything visible (posting is free for everyone). Counter code left in place.
