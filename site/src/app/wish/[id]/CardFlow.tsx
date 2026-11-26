"use client";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { useState } from "react";
import { PLATFORM_FEE_PERCENT, giverTotal } from "@/lib/payments/fees";

const pk = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
const stripePromise = pk ? loadStripe(pk) : null;

type Quote = { feeCents: number; totalCents: number; cardFeeCents: number; platformFeeCents: number; international: boolean };
type PledgeResponse =
  | { kind: "price_changed"; quote: Quote & { country: string | null } }
  | { kind: "pledged"; purchaseId: string; funded: boolean }
  | { kind: "requires_action"; clientSecret: string; setupIntentId: string };

const money = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Card payment failed.");
  return json as T;
}

/**
 * Card / Apple Pay / Google Pay chip-in. The card is SAVED now and charged only once the whole wish
 * is covered (right away if this chip-in covers it). US cards pay the base fee; non-US cards are
 * shown the extra fee before anything is saved.
 */
export function CardFlow(props: { wishId: string; amountCents: number; completes: boolean; windowDays: number; deadline: string | null }) {
  if (!stripePromise) return <div className="notice">Card payments aren&apos;t set up yet.</div>;
  return (
    <Elements stripe={stripePromise} options={{ mode: "setup", currency: "usd", setupFutureUsage: "off_session", allowedPaymentMethodTypes: ["card"] }}>
      <CardForm {...props} />
    </Elements>
  );
}

function CardForm({ wishId, amountCents, completes, windowDays, deadline }: { wishId: string; amountCents: number; completes: boolean; windowDays: number; deadline: string | null }) {
  const stripe = useStripe();
  const elements = useElements();
  const [fee, setFee] = useState<Quote>(() => giverTotal(amountCents));
  const [country, setCountry] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const by = deadline
    ? new Date(deadline).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : `${windowDays} days from now`;

  function finish(funded: boolean) {
    window.location.href = `/wish/${wishId}?${funded ? "funded" : "pledged"}=1`;
  }

  async function pledge() {
    if (!stripe || !elements) return;
    setErr(""); setBusy(true);
    try {
      const { error: submitError } = await elements.submit();
      if (submitError) throw new Error(submitError.message);
      const { error, confirmationToken } = await stripe.createConfirmationToken({ elements });
      if (error) throw new Error(error.message);

      const r = await postJson<PledgeResponse>("/api/stripe/pay", {
        wishId, amountCents, confirmationTokenId: confirmationToken.id, expectedTotalCents: fee.totalCents,
      });
      if (r.kind === "price_changed") {
        // Non-US card: show the new total and let them confirm again. Nothing was saved or charged.
        setFee(r.quote);
        setCountry(r.quote.country);
        return;
      }
      if (r.kind === "requires_action") {
        const { error: actionError } = await stripe.handleNextAction({ clientSecret: r.clientSecret });
        if (actionError) throw new Error(actionError.message);
        const done = await postJson<PledgeResponse>("/api/stripe/pledge", { setupIntentId: r.setupIntentId });
        finish(done.kind === "pledged" && done.funded);
        return;
      }
      finish(r.funded);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="stack" style={{ gap: 4 }}>
        <div className="row" style={{ justifyContent: "space-between" }}><span>Your chip-in</span><span>{money(amountCents)}</span></div>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="hint">Card processing (Stripe){fee.international && ", incl. 1.5% for a non-US card"}</span>
          <span className="hint">{money(fee.cardFeeCents)}</span>
        </div>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="hint">Service fee ({PLATFORM_FEE_PERCENT * 100}%, keeps the site running)</span>
          <span className="hint">{money(fee.platformFeeCents)}</span>
        </div>
        <div className="row" style={{ justifyContent: "space-between" }}><b>{completes ? "You pay now" : "You pay if it fills"}</b><b>{money(fee.totalCents)}</b></div>
      </div>
      <div className="notice">
        {completes
          ? <>This covers the rest of the wish, so your card and every other pledge are charged right away.</>
          : <>Your card is saved, not charged. It&apos;s charged only if the whole wish is covered by <b>{by}</b>. If not, nothing is charged and your card is removed.</>}
      </div>
      {fee.international && (
        <div className="notice">
          Your card is from {country ?? "outside the US"}, so Stripe charges an extra 1.5%. Nothing has happened yet.
          Press the button again to confirm {money(fee.totalCents)}.
        </div>
      )}
      <PaymentElement options={{ layout: "tabs" }} />
      <button className="btn" disabled={busy || !stripe} onClick={pledge}>
        {busy ? "Saving…" : completes ? `Pay ${money(fee.totalCents)}` : `Pledge ${money(fee.totalCents)}`}
      </button>
      <div className="hint">
        Cards from outside the US add 1.5% (Stripe&apos;s international fee). Card details go straight to Stripe; we never see them.
        If a card is declined when the wish fills, what&apos;s already been charged still goes to the wisher and the gap reopens. <a href="/fees">How fees work</a>
      </div>
      {err && <div className="notice err">{err}</div>}
    </div>
  );
}
