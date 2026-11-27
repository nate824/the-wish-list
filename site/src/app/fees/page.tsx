import {
  CARD_FEE_FIXED_CENTS, CARD_FEE_PERCENT, INTL_CARD_FEE_PERCENT, MONTHLY_ACTIVE_FEE_CENTS,
  PAYOUT_FEE_FIXED_CENTS, PAYOUT_FEE_PERCENT, PLATFORM_FEE_PERCENT, giverTotal, usd, wisherFee,
} from "@/lib/payments/fees";

export const metadata = { title: "Fees" };

const pct = (n: number) => `${+(n * 100).toFixed(2)}%`;

function Example({ priceCents }: { priceCents: number }) {
  const us = giverTotal(priceCents);
  const intl = giverTotal(priceCents, { international: true });
  const first = wisherFee(priceCents, { firstThisMonth: true });
  const later = wisherFee(priceCents, { firstThisMonth: false });
  return (
    <tr>
      <td>{usd(priceCents)}</td>
      <td>{usd(us.totalCents)}</td>
      <td>{usd(intl.totalCents)}</td>
      <td>{usd(first.receiveCents)}</td>
      <td>{usd(later.receiveCents)}</td>
    </tr>
  );
}

export default function FeesPage() {
  return (
    <div style={{ maxWidth: 680, margin: "40px auto" }} className="stack">
      <h1 style={{ margin: 0 }}>Fees</h1>
      <p>
        Bitcoin and Lightning gifts have no fees from us: they go straight from the giver&apos;s wallet to the
        wisher&apos;s (your wallet may charge a network fee). Card gifts go through Stripe, which charges for
        processing and payouts. We pass those costs on rather than hide them, and add a small service fee.
      </p>

      <h2>If you give by card</h2>
      <p>You pay the wish price plus:</p>
      <ul>
        <li><b>Card processing:</b> {pct(CARD_FEE_PERCENT)} + {usd(CARD_FEE_FIXED_CENTS)}, Stripe&apos;s fee. Cards issued outside the US add {pct(INTL_CARD_FEE_PERCENT)}; you see the new total before anything is charged.</li>
        <li><b>Service fee:</b> {pct(PLATFORM_FEE_PERCENT)} of the wish price, which keeps The Wish List running.</li>
      </ul>
      <p className="hint">Stripe takes its percentage from the whole charge, so the processing line is worked out on the total, not just the wish price.</p>

      <h2>If you receive a card gift</h2>
      <p>Stripe charges to pay money out to your bank, and that comes out of the gift:</p>
      <ul>
        <li><b>Payout fee:</b> {pct(PAYOUT_FEE_PERCENT)} + {usd(PAYOUT_FEE_FIXED_CENTS)} per gift.</li>
        <li><b>Monthly account fee:</b> {usd(MONTHLY_ACTIVE_FEE_CENTS)}, only in months you receive a card gift, taken from the first one that month.</li>
      </ul>
      <p className="hint">If you choose Stripe&apos;s instant payouts in your Stripe dashboard, Stripe charges extra for those.</p>

      <h2>Examples</h2>
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr><th>Wish</th><th>Giver pays (US card)</th><th>Giver pays (non-US card)</th><th>Wisher gets (first gift this month)</th><th>Wisher gets (later gifts)</th></tr>
          </thead>
          <tbody>
            <Example priceCents={2000} />
            <Example priceCents={5000} />
            <Example priceCents={20000} />
            <Example priceCents={120000} />
          </tbody>
        </table>
      </div>

      <h2>Refunds and disputes</h2>
      <p>
        Gifts are final. If a card payment is disputed, Stripe charges a dispute fee and the gift may be reversed.
        Stripe doesn&apos;t return its processing fee on refunds.
      </p>

      <h2>Where is this going?</h2>
      <p>
        Higher price caps, a registered charity, and more. See the <a href="/roadmap">roadmap</a>.
      </p>
    </div>
  );
}
