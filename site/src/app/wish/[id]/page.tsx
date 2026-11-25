import Link from "next/link";
import { notFound } from "next/navigation";
import { DEMO_MODE, usd } from "@/lib/config";
import { getMe, getWish, getWishBioVideo } from "@/lib/data";
import { STRIPE_ENABLED, giverTotal } from "@/lib/payments/stripe";
import { BuyPanel } from "./BuyPanel";

export const dynamic = "force-dynamic";

export default async function WishPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ posted?: string; paid?: string; saved?: string }>;
}) {
  const { id } = await params;
  const { posted, paid, saved } = await searchParams;
  const [wish, me, bioVideo] = await Promise.all([getWish(id), getMe(), getWishBioVideo(id)]);
  if (!wish) notFound();

  return (
    <div style={{ maxWidth: 640, margin: "40px auto" }} className="stack">
      {posted && (
        <div className="notice ok">
          Your wish is live. Now pay it forward: <Link href="/feed">fund someone else&apos;s wish</Link>.
        </div>
      )}
      {paid && (
        <div className="notice ok">
          Payment received. Thank you! It can take a few seconds to show as funded. If you saved a wish, it goes live then; if not, <Link href="/wish/new">make one now</Link>.
        </div>
      )}
      <div className="panel stack">
        <span className={`pill ${wish.tier}`}>{wish.tier}</span>
        <div style={{ fontSize: "2rem", fontWeight: 800 }}>{usd(wish.price_usd_cents)}</div>
        <h1 style={{ margin: 0, fontSize: "1.5rem" }}>{wish.title}</h1>
        {wish.description && <p style={{ margin: 0 }}>{wish.description}</p>}
        <div className="hint">
          {wish.is_anonymous ? "Anonymous wisher" : <><b>{wish.display_name}</b>{wish.bio && ` · ${wish.bio}`}</>}
        </div>
        {bioVideo && !wish.is_anonymous && (
          <video src={bioVideo} controls playsInline preload="metadata"
            style={{ width: "100%", maxHeight: 420, borderRadius: 10, background: "#000" }} />
        )}
      </div>

      {wish.status === "draft" ? (
        <div className="panel stack">
          <p style={{ margin: 0 }}>
            {saved && <><b>Saved.</b>{" "}</>}Only you can see this wish. It goes live the moment you fund someone else&apos;s wish, any size.
          </p>
          <Link href="/feed" className="btn">Find a wish to fund</Link>
        </div>
      ) : wish.status === "funded" ? (
        <div className="notice ok">This wish has been funded. 🎁</div>
      ) : (
        <BuyPanel
          wishId={wish.id}
          rails={{ btc: !!wish.btc_address, lightning: !!wish.lightning_address, card: wish.accepts_stripe && STRIPE_ENABLED }}
          card={{ priceCents: wish.price_usd_cents, ...giverTotal(wish.price_usd_cents) }}
          signedIn={!!me}
          demo={DEMO_MODE}
        />
      )}
    </div>
  );
}
