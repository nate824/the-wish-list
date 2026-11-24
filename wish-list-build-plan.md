# The Wish List: Build Plan and Setup Checklist

Christmas gifting site. Give to get: you must fund someone else's wish before you can post your own. Target: launch ASAP (Nov 22, 2026 start, Christmas ~Dec 25).

---

## 1. Locked decisions

- **Give-to-get gate.** A user can post a wish only after one verified purchase toward someone else's wish. Any price qualifies ($10 is enough). Own wish price is uncapped.
- **Founding 100.** Launch campaign (social media): the first 100 people to sign up can post one wish without buying anything first. Implementation:
  - `profiles.is_founding_member` boolean, default false.
  - A single-row `founding_counter` table (`claimed int`, `cap int default 100`), or a Postgres sequence.
  - Claim is **atomic in the database** (one transaction, e.g. `update founding_counter set claimed = claimed + 1 where claimed < cap returning claimed`; if no row returned, the user is not a founding member). A rush of signups must not push past 100.
  - Claim on first signup/email verification, not on page visit.
  - The gate becomes: verified purchase **or** `is_founding_member`. Founding pass covers the first wish only; after that the normal gate applies.
  - After posting, push a "now fund someone's wish" nudge so the first 100 become buyers too.
  - Show a live "X of 100 founding spots left" counter on the landing page.
  - Still apply Turnstile and one-per-email so the 100 can't be farmed.
- **No price cap.** Expensive wishes are fine; the feed handles visibility.
- **Feed.** Oldest unfunded first, built in tier slices so every page mixes prices.
  - Tiers: small (< $25), mid ($25-$100), big (> $100).
  - Each page pulls the oldest unfunded wish per tier, then shuffles them together.
  - Funded wishes drop out of the feed.
- **Tier filter.** Top of feed: All / Small / Mid / Big. Big view lets generous buyers find expensive wishes, oldest first.
- **Anonymity.** Wishes can be anonymous (item + price only) or named (display name, short bio, optional photo).
- **Thank-you notes.** Wisher can send a thank-you through the site, even if anonymous.
- **Payment rails (all produce one `purchase` record with a `rail` field):**
  1. **Bitcoin on-chain**, peer to peer, no approval needed.
  2. **Lightning via LNURL-pay + LUD-21 verify**, peer to peer, no approval needed.
  3. **Stripe Connect (Express)**, cards, Apple Pay, Google Pay. Needs Stripe approval.
- The site never holds funds on the BTC and Lightning rails. Stripe holds funds only inside Stripe.

## 2. v1 scope (ship first)

**In:** post wish, browse mixed feed, buy via BTC and Lightning, give-to-get gate, anonymous/named toggle, seeded wishes.

**Week 2-3 (only if core works):** Stripe Connect live, bios and photos, thank-you notes, tier filter UI polish, gift card payout rail (Tremendous/Tango) as optional rail 4.

**Out for now:** shipping, fulfillment, retailer links, refunds, disputes.

## 3. Stack

- Next.js (App Router, TypeScript), deployed on Vercel
- Supabase (Postgres, auth, row-level security)
- Stripe Connect (Express accounts, Checkout, webhooks)
- mempool.space public API for BTC tx lookup and price
- `bip322-js` for signature verification (BIP-322 covers segwit and taproot); `bitcoinjs-message` fallback for legacy addresses
- Resend for transactional email
- Cloudflare Turnstile for bot protection on signup and posting

## 4. Data model (starting point)

```
users            id, email, created_at, is_admin
profiles         user_id, display_name, bio, photo_url, is_anonymous,
                 is_founding_member (bool, default false), founding_claimed_at
founding_counter claimed (int), cap (int, default 100)   -- single row, atomic increment
wishes           id, user_id, title, description, price_usd_cents, tier (generated),
                 status (open | funded | cancelled), created_at, funded_at,
                 btc_address, lightning_address, stripe_account_id
purchases        id, wish_id, buyer_id, rail (btc | lightning | stripe),
                 amount_usd_cents, status (pending | verified | rejected | review),
                 -- btc
                 txid, sender_address, signed_message, signature, btc_amount_sats
                 -- lightning
                 ln_invoice, ln_verify_url, ln_payment_hash, settled_at
                 -- stripe
                 stripe_checkout_session_id, stripe_payment_intent_id
                 created_at, verified_at
thank_yous       id, purchase_id, from_user_id, message, created_at
```

Rules:
- Posting gate in the database: allowed if a verified purchase exists for the user **or** the user is a founding member who hasn't posted yet.
- Tier is derived from `price_usd_cents`.
- Unique constraints: `txid` unique across purchases, `ln_payment_hash` unique, one verified purchase counts once toward the gate.
- User can post a wish only if `exists(select 1 from purchases where buyer_id = user and status = 'verified')`. Enforce in the database (RLS or function), not just the UI.
- Buyer cannot buy their own wish.

## 5. Flows

### 5.1 Post a wish
1. Sign up (email magic link).
2. Gate check: has a verified purchase? If not, send to feed with "fund a wish first."
3. Form: title, price, optional description, anonymous toggle (+ bio/photo if named), at least one payout method (BTC address, Lightning address, Stripe).
4. Validate payout methods on save (see below).

### 5.2 Buy via Bitcoin
1. Buyer picks a wish; site shows the wisher's BTC address, USD price, and a BTC amount from the live price with a tolerance band (suggest ±3%, quote locked for 15 minutes).
2. Buyer sends BTC from their wallet.
3. Buyer returns, pastes txid. Site looks the tx up on mempool.space: confirm an output to the wish address of at least the minimum sats, and no prior use of this txid.
4. Site gives a message to sign: `wishlist:claim:<txid>:<nonce>`. Buyer signs with the address that funded the tx (any input address) and pastes the signature.
5. Verify the signature against that address. Mark verified. Accept at 1 confirmation (or 0-conf under a small threshold, your call).
6. Fallback: **exchange senders can't sign.** Offer a "can't sign" path that sends the purchase to a manual review queue (admin approves or rejects).
7. Prompt wishers to use a fresh address per wish (privacy).

### 5.3 Buy via Lightning (LNURL-pay + LUD-21)
1. On wish creation, resolve the Lightning address `name@domain` by fetching `https://domain/.well-known/lnurlp/name`.
2. **Validate:** request a test invoice from the callback and confirm the response includes a `verify` URL (LUD-21). If not, reject: "Please use a Lightning address from a provider that supports verify."
3. On purchase, request an invoice from the callback for the wish's sat amount, show it as QR plus a deep link.
4. Poll the `verify` URL until `settled: true`, then mark verified. Store payment hash; one payment per posted wish.
5. Keep a short list of known-good providers and test them before launch.

### 5.4 Buy via Stripe Connect
1. Wisher onboards lazily: when their first gift lands (or when they choose Stripe), create an Express connected account and send them through hosted onboarding. Funds are held until they finish.
2. Buyer pays through Stripe Checkout (cards, Apple Pay, Google Pay) using destination charges or separate transfers.
3. Webhook `checkout.session.completed` marks the purchase verified.
4. Platform fee: optional, start at 0 or small.
5. Stays in test mode until the Stripe platform application clears.

## 6. Anti-gaming (self-funding is the main risk)

- Minimum purchase to count toward the gate: $5 (tune later).
- One verified purchase per posted wish (consumed when used).
- Unique txid and payment hash.
- Buyer cannot fund own wish; flag pairs of accounts funding each other back and forth.
- Flag same-IP / same-device clusters for review.
- Turnstile on signup and posting.
- Be honest about the limit: no rail is fully sybil-proof. Stripe's fee is the only rail where cheating costs real money. Goal is nudging generosity, not perfect enforcement.

## 7. Cold start and launch campaign

- An empty feed is dead on arrival. Seed **30-50 real wishes** from friends and family before announcing.
- Seeded wishers should include a mix of tiers and a few with short bios.
- **Founding 100 social campaign:** first 100 visitors post a wish free. Risk: the first 100 wishes land with zero buyers. Mitigate by lining up a handful of real buyers (friends putting in $10 each) before the campaign goes out, and by nudging founding members to fund someone right after posting.
- Tell people honestly: wishes are funded by other users, nothing is guaranteed.

## 8. Legal and risk notes (not legal advice)

- Peer-to-peer BTC and Lightning where the site never custodies funds is the lowest-risk path. Do not hold buyer funds on those rails.
- Stripe Connect puts compliance on Stripe; confirm current review times and fund-hold limits in their docs.
- Gift card API payouts (if added): check provider terms and fees.
- Talk to a lawyer before launch about money transmitter rules, terms of service, privacy policy, and wisher data (addresses are never collected in v1).
- Add a visible disclaimer: gifts are voluntary, no guarantee a wish is funded.

---

## 9. SETUP CHECKLIST (do this before the Claude Code session)

Goal: every credential exists and is pasted into `.env.local`, so Claude Code needs nothing from you mid-build.

### 9.1 Do today (long lead time)
- [ ] **Stripe:** create account, activate it, enable **Connect** (Express), fill out the platform profile (marketplace where users fund gifts for other users). Submit for review today. Use **test mode** keys until it clears.
- [ ] **Domain:** pick the name and register it (or choose a subdomain of one you own).

### 9.2 Accounts to create
- [ ] **GitHub:** new empty repo (private is fine) for the project.
- [ ] **Vercel:** account linked to GitHub. Create the project after the first push.
- [ ] **Supabase:** new project. Note region. Save database password.
- [ ] **Resend:** account, verify your sending domain (add DNS records).
- [ ] **Cloudflare Turnstile:** create a site, get site key and secret.

### 9.3 Keys and values to collect

Put these in `.env.local` (and later in Vercel project env vars):

```
# Supabase (Project Settings > API)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_DB_URL=                      # for migrations (Project Settings > Database)

# Stripe (test mode for now)
STRIPE_SECRET_KEY=sk_test_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...       # from `stripe listen` locally, dashboard endpoint in prod

# Email
RESEND_API_KEY=
EMAIL_FROM=                           # e.g. wishes@yourdomain.com

# Bot protection
NEXT_PUBLIC_TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=

# App
NEXT_PUBLIC_SITE_URL=http://localhost:3000
ADMIN_EMAILS=                         # comma-separated, gets admin/review queue access
```

No keys needed for: mempool.space API (public), LNURL/Lightning address resolution (public HTTP), BIP-322 verification (library, runs locally).

### 9.4 Tools on your machine
- [ ] Node 20+, git, and the GitHub CLI (`gh auth login`)
- [ ] Vercel CLI (`npm i -g vercel`, then `vercel login`)
- [ ] Supabase CLI (`brew install supabase/tap/supabase` or npm; `supabase login`)
- [ ] Stripe CLI (`stripe login`) for local webhook forwarding
- [ ] Claude Code logged in

### 9.5 Decisions to make now so Claude Code doesn't ask
- [ ] Site name and domain
- [ ] Minimum purchase to count toward the gate (default $5)
- [ ] Platform fee on Stripe (default 0%)
- [ ] BTC confirmation threshold (default 1 conf; 0-conf under $50?)
- [ ] Your own BTC address and Lightning address for testing, plus a second test wallet that supports BIP-322 signing
- [ ] List of 30-50 seed wishes (or a list of people to ask)
- [ ] Founding 100: confirm cap (100) and that the pass covers one wish only
- [ ] A few friends lined up to buy early so founding wishes get funded

### 9.6 Test wallets
- [ ] One on-chain wallet that can sign messages (segwit/taproot via BIP-322)
- [ ] One Lightning address from a provider that supports LUD-21 verify (test it before building around it)
- [ ] A small balance in each for end-to-end testing

---

## 10. Build order for Claude Code

1. Scaffold Next.js + TypeScript + Supabase; schema and migrations; RLS including the give-to-get gate.
2. Auth (magic link), profiles, anonymous/named toggle, founding-100 flag and atomic counter.
3. Wish CRUD with payout-method validation (BTC address format, Lightning address test invoice).
4. Tiered mixed feed query + tier filter.
5. BTC purchase flow (tx lookup, BIP-322 verify, manual review queue).
6. Lightning purchase flow (LNURL-pay invoice, LUD-21 poll).
7. Gate enforcement on posting (verified purchase or unused founding pass).
8. Stripe Connect (test mode): onboarding, Checkout, webhook.
9. Anti-gaming checks, Turnstile, admin review page.
10. Email notifications, thank-yous, seed script, deploy to Vercel.

## 11. Kickoff prompt to paste into Claude Code

> Read `wish-list-build-plan.md` in the repo root. Build it in the order in section 10. All credentials are in `.env.local`. Use test mode for Stripe. Make the give-to-get gate enforced in the database, not only the UI. Don't ask me questions unless something in the plan is contradictory; make a reasonable call, note it in `DECISIONS.md`, and keep going. After each step, run the app and tests and fix failures before moving on.

---

## 12. Open risks to watch

- Stripe review could be slow or ask extra questions; BTC and Lightning go live first.
- Exchange-sourced BTC buyers can't sign; manual review queue must exist at launch.
- Lightning provider support for LUD-21 varies; validate at wish creation.
- Self-gifting can't be fully stopped; keep detection light and don't over-engineer.
- Audience: most gift buyers aren't Bitcoin holders. Stripe is what unlocks the mainstream, so don't let its approval slip.
