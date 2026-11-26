import { redirect } from "next/navigation";
import { DEMO_MODE, usd } from "@/lib/config";
import { getMe } from "@/lib/data";
import { supabaseAdmin } from "@/lib/supabase/server";
import { ConfirmButtons } from "./ConfirmButtons";

export const dynamic = "force-dynamic";

type Row = {
  id: string; amount_usd_cents: number; btc_amount_sats: number | null; paid_claimed_at: string | null;
  wishes: { title: string; lightning_address: string | null } | null;
};

// Wishers confirm Lightning gifts sent to wallets that can't confirm on their own (e.g. Strike).
export default async function GiftsPage() {
  if (DEMO_MODE) return <div style={{ maxWidth: 560, margin: "40px auto" }} className="notice">Gifts need Supabase.</div>;
  const me = await getMe();
  if (!me) redirect("/login?next=/gifts");

  const { data } = await supabaseAdmin()
    .from("purchases")
    .select("id, amount_usd_cents, btc_amount_sats, paid_claimed_at, wishes!purchases_wish_id_fkey!inner(title, lightning_address, user_id)")
    .eq("rail", "lightning").eq("ln_confirm_mode", "wisher").eq("status", "pending")
    .not("paid_claimed_at", "is", null)
    .eq("wishes.user_id", me.id)
    .order("paid_claimed_at");
  const rows = (data ?? []) as unknown as Row[];

  return (
    <div style={{ maxWidth: 640, margin: "40px auto" }} className="stack">
      <h1 style={{ margin: 0 }}>Confirm your gifts</h1>
      <p className="hint">
        Your Lightning wallet can&apos;t tell us when a gift lands, so we need you to. Open your wallet, check the
        sats arrived, then tap &ldquo;I got it&rdquo;. That counts the gift toward your wish and the giver&apos;s score.
      </p>
      {rows.length === 0 ? <div className="notice">Nothing waiting.</div> : rows.map((r) => (
        <div key={r.id} className="panel stack">
          <div><b>{r.wishes?.title}</b></div>
          <div className="hint">
            {r.btc_amount_sats?.toLocaleString()} sats ({usd(r.amount_usd_cents)}) to {r.wishes?.lightning_address}
          </div>
          <ConfirmButtons purchaseId={r.id} />
        </div>
      ))}
    </div>
  );
}
