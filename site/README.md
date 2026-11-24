# The Wish List (site)

Give to get: fund a stranger's wish, then post your own. Built from `../wish-list-build-plan.md`.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
```

No keys? It runs in **demo mode**: sample wishes, no sign-in, no payments. Good for looking at the UI.

## Go live with Supabase

1. Create a Supabase project. Copy `.env.example` to `.env.local` and fill the Supabase lines.
2. Run the migrations in order: paste each file in `supabase/migrations/` (0001, 0002, ...) into the Supabase SQL editor
   (or `supabase db push` with the CLI).
3. Supabase > Authentication > URL configuration: add `http://localhost:3000/auth/callback`
   (and your real domain later) to Redirect URLs.
4. Put your email in `ADMIN_EMAILS` to see the review queue at `/admin`.

## What works

| Area | Status |
|---|---|
| Landing page + live Founding 100 counter | done |
| Feed: oldest first, mixed tiers, All/Small/Mid/Big filter | done |
| Magic-link sign-in, founding spot claimed atomically on first sign-in | done |
| Post a wish: anonymous/named, BTC + Lightning address validation | done |
| Give-to-get gate **in the database** (`post_wish()`; direct inserts blocked) | done, tested |
| BTC: locked quote, txid check on mempool.space, BIP-322 signature verify, can't-sign review queue | done |
| Lightning: LNURL-pay invoice, amount/description-hash check, LUD-21 verify polling, SSRF guard | done, light UI, untested against real wallets |
| Admin review page | done |
| Stripe Connect (test mode): card checkout with giver-paid fee, wisher payout setup, held gifts released on onboarding | built, needs keys + migration 0003 |
| Turnstile, thank-you notes UI, emails, rate limits, seed script | not yet |

## Stripe (cards, Apple Pay, Google Pay)

Separate charges and transfers. The giver pays wish price + card fee on the platform account;
the gift is held in Stripe until the wisher finishes payout setup at `/payouts`, then the full
wish price is transferred to their connected account (Accounts v2, recipient only, Express dashboard).

1. Run `supabase/migrations/0002_stripe_fees.sql` and `0003_stripe_connect.sql`.
2. Put the **test** secret and publishable keys in `.env.local` (Stripe Dashboard > Developers > API keys).
   Live keys are refused unless `STRIPE_ALLOW_LIVE=true`.
3. Local webhooks, in two terminals:
   - `stripe listen --forward-to localhost:3000/api/stripe/webhook` and put its `whsec_...` in `STRIPE_WEBHOOK_SECRET`.
   - `stripe listen --events 'v2.core.account[configuration.recipient].capability_status_updated' --events-from @accounts --forward-to localhost:3000/api/stripe/connect/events`
     and put its secret in `STRIPE_CONNECT_WEBHOOK_SECRET`. (Optional locally: returning from onboarding also releases held gifts.)
4. Pay with test card `4242 4242 4242 4242` (US). To see the non-US fee, use `4000 0082 6000 0000` (UK) or another country card from Stripe's testing docs. As the wisher, open `/payouts` and use Stripe's test onboarding data.
5. Production: add two webhook endpoints / event destinations in the Dashboard with the same events. The platform endpoint needs `payment_intent.succeeded` and `payment_intent.payment_failed` (card gifts), plus `checkout.session.completed` for any old Checkout sessions.

## Layout

- `supabase/migrations/0001_init.sql`: schema, RLS, gate, founding counter, feed view
- `src/lib/payments/`: `btc.ts`, `lightning.ts`, `price.ts`, `stripe.ts` (stub)
- `src/app/`: pages and API routes
- `DECISIONS.md`: calls made where the plan was open
