import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { DEMO_MODE, usd } from "@/lib/config";
import { getMe } from "@/lib/data";
import { supabaseAdmin } from "@/lib/supabase/server";
import { BIO_VIDEO_BUCKET, bioVideoUrl } from "@/lib/bioVideo";

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

/** Moderation: hide a bio video. Deletes the file (the bucket is public) and keeps the profile flagged. */
async function hideVideo(form: FormData) {
  "use server";
  const me = await getMe();
  if (!me?.isAdmin) throw new Error("not allowed");
  const userId = String(form.get("user_id"));
  const path = String(form.get("path"));
  const admin = supabaseAdmin();
  await admin.from("profiles").update({ bio_video_hidden: true, bio_video_path: null })
    .eq("user_id", userId).eq("bio_video_path", path);
  await admin.storage.from(BIO_VIDEO_BUCKET).remove([path]);
  revalidatePath("/admin");
}

type VideoRow = { user_id: string; display_name: string | null; bio_video_path: string; bio_video_updated_at: string | null };

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
  const { data: vids } = await supabaseAdmin()
    .from("profiles")
    .select("user_id, display_name, bio_video_path, bio_video_updated_at")
    .not("bio_video_path", "is", null)
    .order("bio_video_updated_at", { ascending: false, nullsFirst: false })
    .limit(30);
  const videos = (vids ?? []) as VideoRow[];

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
      <h2 className="section">Recent bio videos</h2>
      <p className="hint">Newest first. Hide deletes the file and blocks that user&apos;s future videos from showing until you clear bio_video_hidden.</p>
      {videos.length === 0 ? <div className="notice">No bio videos yet.</div> : (
        <div className="stack">
          {videos.map((v) => (
            <div key={v.user_id} className="panel stack">
              <b>{v.display_name ?? "(no name)"}</b>
              <video src={bioVideoUrl(v.bio_video_path)} controls preload="metadata" style={{ width: "100%", maxHeight: 280, background: "#000" }} />
              <form action={hideVideo}>
                <input type="hidden" name="user_id" value={v.user_id} />
                <input type="hidden" name="path" value={v.bio_video_path} />
                <button className="btn small secondary">Hide video</button>
              </form>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
