"use client";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { useState } from "react";

const pk = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
const stripePromise = pk ? loadStripe(pk) : null;

type Card = { priceCents: number; feeCents: number; totalCents: number };
type PayResponse =
  | { kind: "price_changed"; quote: { feeCents: number; totalCents: number; international: boolean; country: string | null } }
  | { kind: "succeeded" | "processing"; purchaseId: string }
  | { kind: "requires_action"; purchaseId: string; clientSecret: string };

const money = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

/** Card / Apple Pay / Google Pay. US cards pay the base fee; non-US cards are shown the extra fee before paying. */
export function CardFlow({ wishId, card }: { wishId: string; card: Card }) {
  if (!stripePromise) return <div className="notice">Card payments aren&apos;t set up yet.</div>;
  return (
    <Elements
      stripe={stripePromise}
      options={{ mode: "payment", amount: card.totalCents, currency: "usd", allowedPaymentMethodTypes: ["card"] }}
    >
      <CardForm wishId={wishId} card={card} />
    </Elements>
  );
}

function CardForm({ wishId, card }: { wishId: string; card: Card }) {
  const stripe = useStripe();
  const elements = useElements();
  const [fee, setFee] = useState({ feeCents: card.feeCents, totalCents: card.totalCents, international: false });
  const [country, setCountry] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  async function pay() {
    if (!stripe || !elements) return;
    setErr(""); setBusy(true);
    try {
      const { error: submitError } = await elements.submit();
      if (submitError) throw new Error(submitError.message);
      const { error, confirmationToken } = await stripe.createConfirmationToken({ elements });
      if (error) throw new Error(error.message);

      const res = await fetch("/api/stripe/pay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wishId, confirmationTokenId: confirmationToken.id, expectedTotalCents: fee.totalCents }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Card payment failed.");
      const r = json as PayResponse;

      if (r.kind === "price_changed") {
        // Non-US card: show the new total and let them pay again. Nothing was charged.
        setFee({ feeCents: r.quote.feeCents, totalCents: r.quote.totalCents, international: r.quote.international });
        setCountry(r.quote.country);
        elements.update({ amount: r.quote.totalCents });
        return;
      }
      if (r.kind === "requires_action") {
        const { error: actionError } = await stripe.handleNextAction({ clientSecret: r.clientSecret });
        if (actionError) throw new Error(actionError.message);
      }
      setDone(true);
      window.location.href = `/wish/${wishId}?paid=1`;
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (done) return <div className="notice ok">Paid. Thank you!</div>;
  return (
    <div className="stack">
      <div className="stack" style={{ gap: 4 }}>
        <div className="row" style={{ justifyContent: "space-between" }}><span>Gift</span><span>{money(card.priceCents)}</span></div>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="hint">
            Card fee (Stripe&apos;s cut, so the wisher gets it all){fee.international && ", incl. 1.5% for a non-US card"}
          </span>
          <span className="hint">{money(fee.feeCents)}</span>
        </div>
        <div className="row" style={{ justifyContent: "space-between" }}><b>You pay</b><b>{money(fee.totalCents)}</b></div>
      </div>
      {fee.international && (
        <div className="notice">
          Your card is from {country ?? "outside the US"}, so Stripe charges an extra 1.5%. Nothing has been charged yet.
          Press pay again to send {money(fee.totalCents)}.
        </div>
      )}
      <PaymentElement options={{ layout: "tabs" }} />
      <button className="btn" disabled={busy || !stripe} onClick={pay}>
        {busy ? "Processing…" : `Pay ${money(fee.totalCents)}`}
      </button>
      <div className="hint">Cards from outside the US add 1.5% (Stripe&apos;s international fee). Card details go straight to Stripe; we never see them.</div>
      {err && <div className="notice err">{err}</div>}
    </div>
  );
}
