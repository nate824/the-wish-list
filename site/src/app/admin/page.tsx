import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { DEMO_MODE, usd } from "@/lib/config";
import { getMe } from "@/lib/data";
import { supabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function decide(form: FormData) {
  "use server";
  const me = await getMe();
  if (!me?.isAdmin) throw new Error("not allowed");
  const id = String(form.get("id"));
  const approve = form.get("decision") === "approve";
  await supabaseAdmin()
    .from("purchases")
    .update({ status: approve ? "verified" : "rejected", review_note: `${approve ? "approved" : "rejected"} by ${me.email}` })
    .eq("id", id)
    .eq("status", "review");
  revalidatePath("/admin");
}

type Row = {
  id: string; txid: string | null; amount_usd_cents: number; btc_amount_sats: number | null;
  created_at: string; review_note: string | null; wishes: { title: string; btc_address: string | null } | null;
};

export default async function Admin() {
  if (DEMO_MODE) return <div className="notice" style={{ marginTop: 40 }}>Review queue needs Supabase.</div>;
  const me = await getMe();
  if (!me?.isAdmin) notFound();

  const { data } = await supabaseAdmin()
    .from("purchases")
    .select("id, txid, amount_usd_cents, btc_amount_sats, created_at, review_note, wishes!purchases_wish_id_fkey(title, btc_address)")
    .eq("status", "review")
    .order("created_at");
  const rows = (data ?? []) as unknown as Row[];

  return (
    <div style={{ paddingTop: 32 }} className="stack">
      <h2 className="section">Manual review: unsigned BTC gifts and flagged Lightning confirmations</h2>
      <p className="hint">Check the txid on mempool.space: does it pay the wish address at least the quoted sats? Approve unlocks the buyer&apos;s wish post and marks the wish funded.</p>
      {rows.length === 0 ? <div className="notice">Queue is empty.</div> : (
        <table>
          <thead><tr><th>Wish</th><th>Amount</th><th>Tx</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.wishes?.title}<div className="hint mono">{r.wishes?.btc_address}</div>{r.review_note && <div className="hint">{r.review_note}</div>}</td>
                <td>{usd(r.amount_usd_cents)}<div className="hint">{r.btc_amount_sats?.toLocaleString()} sats</div></td>
                <td className="mono">{r.txid && <a href={`https://mempool.space/tx/${r.txid}`} target="_blank" rel="noreferrer">{r.txid.slice(0, 16)}…</a>}</td>
                <td>
                  <form action={decide} className="row">
                    <input type="hidden" name="id" value={r.id} />
                    <button className="btn small" name="decision" value="approve">Approve</button>
                    <button className="btn small secondary" name="decision" value="reject">Reject</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
