// Fee math for card gifts. Pure functions (no Stripe client) so pages and forms can show the same numbers.
//
// Who pays what (Nate, 2026-11-24):
//   Giver:  wish price + Stripe card fee (2.9% + 30c, +1.5% for a non-US card) + 1% platform fee.
//   Wisher: Stripe's Connect payout costs come out of the gift:
//             0.25% + 25c per gift, plus $2 on the first gift paid out to them in a calendar month
//             (Stripe bills the platform $2 per active connected account per month).
//   Bitcoin and Lightning gifts are wallet to wallet, so none of this applies to them.
// Stripe standard US pricing; confirm against the account's actual pricing before launch.

export const CARD_FEE_PERCENT = 0.029;
export const CARD_FEE_FIXED_CENTS = 30;
/** Stripe's extra fee when the card was issued outside the US. */
export const INTL_CARD_FEE_PERCENT = 0.015;
/** The Wish List's own cut, for maintenance and development. Card gifts only. */
export const PLATFORM_FEE_PERCENT = 0.01;

/** Stripe Connect costs passed on to the wisher. */
export const PAYOUT_FEE_PERCENT = 0.0025;
export const PAYOUT_FEE_FIXED_CENTS = 25;
export const MONTHLY_ACTIVE_FEE_CENTS = 200;

/**
 * What the giver pays. Gross-up so Stripe's percentage also covers the platform fee:
 *   total = (price + platform fee + 30c) / (1 - card percent), rounded up to the cent.
 * $50 wish, US card: $52.32 (platform $0.50, card $1.82).
 */
export function giverTotal(priceCents: number, opts: { international?: boolean } = {}) {
  const percent = CARD_FEE_PERCENT + (opts.international ? INTL_CARD_FEE_PERCENT : 0);
  const platformFeeCents = Math.ceil(priceCents * PLATFORM_FEE_PERCENT);
  const totalCents = Math.ceil((priceCents + platformFeeCents + CARD_FEE_FIXED_CENTS) / (1 - percent));
  const feeCents = totalCents - priceCents; // everything on top of the wish price
  return {
    totalCents,
    feeCents,
    platformFeeCents,
    cardFeeCents: feeCents - platformFeeCents,
    international: !!opts.international,
  };
}

/** What comes out of a card gift before it reaches the wisher. */
export function wisherFee(priceCents: number, opts: { firstThisMonth: boolean; firstForWish?: boolean }) {
  const fixed = opts.firstForWish === false ? 0 : PAYOUT_FEE_FIXED_CENTS;
  const payoutCents = Math.ceil(priceCents * PAYOUT_FEE_PERCENT) + fixed;
  const monthlyCents = opts.firstThisMonth ? MONTHLY_ACTIVE_FEE_CENTS : 0;
  const feeCents = Math.min(priceCents - 1, payoutCents + monthlyCents); // always send at least 1 cent
  return { feeCents, payoutCents, monthlyCents, receiveCents: priceCents - feeCents };
}

export const usd = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
