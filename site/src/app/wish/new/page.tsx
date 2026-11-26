import Link from "next/link";
import { redirect } from "next/navigation";
import { DEMO_MODE, usd } from "@/lib/config";
import { getLimits, getMe } from "@/lib/data";
import { STRIPE_ENABLED } from "@/lib/payments/stripe";
import { WishForm } from "./WishForm";

export const dynamic = "force-dynamic";

export default async function NewWish() {
  const [me, limits] = await Promise.all([getMe(), getLimits()]);
  if (!DEMO_MODE && !me) redirect("/login?next=/wish/new");

  return (
    <div style={{ maxWidth: 560, margin: "40px auto" }} className="stack">
      <h2 className="section" style={{ margin: 0 }}>Make a wish</h2>
      <div className="notice">
        Your wish goes live right away. It ranks higher the more you give to others:{" "}
        {me && me.givingScore > 0
          ? <>you have <b>{me.givingScore} giving points</b> from helping {me.wishesHelped} wish{me.wishesHelped === 1 ? "" : "es"}.</>
          : <>you have no giving points yet, so it starts near the end of the list. <Link href="/feed">Chip in on any wish</Link>, even {usd(limits.min_contribution_cents)}, to move it up.</>}
      </div>
      <WishForm stripeEnabled={STRIPE_ENABLED} maxPriceCents={limits.max_price_cents} userId={me?.id ?? null} />
    </div>
  );
}
