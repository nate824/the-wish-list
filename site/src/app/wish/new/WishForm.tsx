"use client";
import { useActionState, useState } from "react";
import { postWish, type PostState } from "./actions";
import { usd, wisherFee } from "@/lib/payments/fees";
import { BioVideoInput } from "./BioVideoInput";

export function WishForm({ stripeEnabled, maxPriceCents, userId }: { stripeEnabled: boolean; maxPriceCents: number; userId: string | null }) {
  const [state, action, pending] = useActionState<PostState, FormData>(postWish, {});
  const [anon, setAnon] = useState(true);
  const [priceCents, setPriceCents] = useState(0);
  const [uploading, setUploading] = useState(false);
  return (
    <form action={action} className="panel stack">
      <div>
        <label htmlFor="title">What do you wish for?</label>
        <input id="title" name="title" type="text" maxLength={120} required placeholder="Warm winter boots, size 9" />
      </div>
      <div>
        <label htmlFor="price">Price in USD <span className="hint">($5 to {usd(maxPriceCents)}; people can chip in together)</span></label>
        <input type="hidden" name="max_price_cents" value={maxPriceCents} />
        <input id="price" name="price" type="number" min={5} max={maxPriceCents / 100} step="0.01" required placeholder="250"
          onChange={(e) => setPriceCents(Math.round(Number(e.target.value) * 100) || 0)} />
        {stripeEnabled && priceCents >= 500 && (
          <span className="hint">
            Paid by card, you&apos;d get about {usd(wisherFee(priceCents, { firstThisMonth: true }).receiveCents)} after
            Stripe&apos;s payout fees ({usd(wisherFee(priceCents, { firstThisMonth: false }).receiveCents)} if you already got a
            card gift this month). Bitcoin gifts arrive in full. <a href="/fees" target="_blank">Fees</a>
          </span>
        )}
      </div>
      <div>
        <label htmlFor="description">A little context <span className="hint">(optional)</span></label>
        <textarea id="description" name="description" maxLength={1000} />
      </div>
      <div>
        <label><input type="checkbox" name="anonymous" checked={anon} onChange={(e) => setAnon(e.target.checked)} /> Post anonymously <span className="hint">(only the item and price are shown)</span></label>
      </div>
      {!anon && (
        <>
          <div><label htmlFor="display_name">Display name</label><input id="display_name" name="display_name" type="text" maxLength={60} /></div>
          <div><label htmlFor="bio">Short bio <span className="hint">(optional, 280 chars)</span></label><textarea id="bio" name="bio" maxLength={280} /></div>
          <BioVideoInput userId={userId} onBusy={setUploading} />
        </>
      )}
      <hr style={{ border: 0, borderTop: "1px solid var(--line)", width: "100%" }} />
      <div className="hint">How should gifts reach you? Add at least one. Money goes straight to you; we never hold it.</div>
      <div>
        <label htmlFor="btc_address">Bitcoin address <span className="hint">(use a fresh address for each wish)</span></label>
        <input id="btc_address" name="btc_address" type="text" className="mono" placeholder="bc1q…" />
      </div>
      <div>
        <label htmlFor="lightning_address">Lightning address <span className="hint">(name@provider, must support payment verification)</span></label>
        <input id="lightning_address" name="lightning_address" type="text" placeholder="you@getalby.com" />
      </div>
      <div>
        <label>
          <input type="checkbox" name="accepts_stripe" disabled={!stripeEnabled} defaultChecked={stripeEnabled} /> Accept card payments{" "}
          <span className="hint">{stripeEnabled ? "(you'll set up payouts when your first gift lands)" : "(coming soon)"}</span>
        </label>
      </div>
      {state.error && <div className="notice err">{state.error}</div>}
      <button className="btn" disabled={pending || uploading}>{uploading ? "Uploading video…" : pending ? "Checking…" : "Post my wish"}</button>
    </form>
  );
}
