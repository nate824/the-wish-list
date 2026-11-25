import Link from "next/link";
import { after } from "next/server";
import { notFound } from "next/navigation";
import { FundingBar } from "@/components/FundingBar";
import { DEMO_MODE, usd } from "@/lib/config";
import { getLimits, getMe, getMyFailedPledges, getWish } from "@/lib/data";
import { sweepPledges } from "@/lib/payments/pledges";
import { STRIPE_ENABLED } from "@/lib/payments/stripe";
import { supabaseAdmin } from "@/lib/supabase/server";
import { BuyPanel } from "./BuyPanel";

export const dynamic = "force-dynamic";

export default async function WishPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ posted?: string; paid?: string; pledged?: string; funded?: string }>;
}) {
  const { id } = await params;
  const { posted, paid, pledged, funded } = await searchParams;
  const [wish, me, limits] = await Promise.all([getWish(id), getMe(), getLimits()]);
  if (!wish) notFound();
  const failed = me && wish.status === "open" ? await getMyFailedPledges(wish.id, me.id) : [];

  // Housekeeping after the response: charge pledges if a crypto chip-in closed the gap, release expired cards.
  if (!DEMO_MODE && wish.status === "open" && wish.pledged_usd_cents > 0) {
    after(() => sweepPledges(supabaseAdmin(), wish.id).catch((e) => console.error("sweep", e)));
  }

  const left = Math.max(0, wish.price_usd_cents - wish.collected_usd_cents - wish.pledged_usd_cents);

  return (
    <div style={{ maxWidth: 640, margin: "40px auto" }} className="stack">
      {posted && (
        <div className="notice ok">
          Your wish is live. Want it higher in the list? <Link href="/feed">Chip in on someone else&apos;s wish</Link>: every gift you give moves your wishes up.
        </div>
      )}
      {(paid || funded) && (
        <div className="notice ok">
          {funded ? "That covered it. The wish is funded and every pledge is being charged now. 🎁" : "Payment received. Thank you!"} Your giving score goes up as soon as it clears.
        </div>
      )}
      {pledged && !funded && (
        <div className="notice ok">
          Pledge saved. Your card is charged only if this wish is fully covered by its deadline. If not, nothing is charged.
        </div>
      )}
      {failed.length > 0 && (
        <div className="notice err">
          Your card was declined when this wish filled, so your {usd(failed[0].amount_usd_cents)} chip-in didn&apos;t go through
          and the gap reopened. Chip in again below to keep it funded.
        </div>
      )}
      <div className="panel stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className={`pill ${wish.tier}`}>{wish.tier}</span>
          {wish.owner_score > 0 && <span className="hint" title="Wishers who give rank higher in the list">⭐ Giver: {wish.owner_score} pts</span>}
        </div>
        <div style={{ fontSize: "2rem", fontWeight: 800 }}>{usd(wish.price_usd_cents)}</div>
        <h1 style={{ margin: 0, fontSize: "1.5rem" }}>{wish.title}</h1>
        {wish.description && <p style={{ margin: 0 }}>{wish.description}</p>}
        <div className="hint">
          {wish.is_anonymous ? "Anonymous wisher" : <><b>{wish.display_name}</b>{wish.bio && ` · ${wish.bio}`}</>}
        </div>
        {wish.status === "open" && <FundingBar wish={wish} detailed />}
      </div>

      {wish.status === "funded" ? (
        <div className="notice ok">This wish has been funded. 🎁</div>
      ) : (
        <BuyPanel
          wishId={wish.id}
          rails={{ btc: !!wish.btc_address, lightning: !!wish.lightning_address, card: wish.accepts_stripe && STRIPE_ENABLED }}
          leftCents={left}
          minCents={Math.min(limits.min_contribution_cents, left)}
          windowDays={limits.pledge_window_days}
          deadline={wish.funding_deadline}
          signedIn={!!me}
          demo={DEMO_MODE}
        />
      )}
    </div>
  );
}
