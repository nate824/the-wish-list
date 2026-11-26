import { NextResponse } from "next/server";
import { fail, requireBuyer } from "@/lib/api";
import { checkSettled } from "@/lib/payments/lightning";
import { afterChipInVerified } from "@/lib/payments/pledges";

// Lightning step 2: client polls this; we poll the LUD-21 verify URL.
// TODO: background re-check for buyers who close the tab (lnurl-checklist #5), and expire
// unpaid invoices to 'rejected' (#6).
export async function GET(req: Request) {
  const auth = await requireBuyer();
  if ("res" in auth) return auth.res;
  const id = new URL(req.url).searchParams.get("purchaseId");
  if (!id) return fail("Missing purchase.");
  const { data: p } = await auth.admin
    .from("purchases").select("id, buyer_id, status, ln_verify_url, ln_payment_hash, ln_confirm_mode, paid_claimed_at").eq("id", id).maybeSingle();
  if (!p || p.buyer_id !== auth.user.id) return fail("Purchase not found.", 404);
  if (p.status !== "pending") return NextResponse.json({ status: p.status });
  // No LUD-21 on the wisher's wallet: nothing to poll, we wait for the wisher to confirm.
  if (p.ln_confirm_mode === "wisher" || !p.ln_verify_url) {
    return NextResponse.json({ status: p.paid_claimed_at ? "awaiting_wisher" : "pending" });
  }

  const settled = await checkSettled(p.ln_verify_url!, p.ln_payment_hash).catch(() => false);
  if (!settled) return NextResponse.json({ status: "pending" });
  const { error } = await auth.admin
    .from("purchases").update({ status: "verified", settled_at: new Date().toISOString() }).eq("id", id);
  if (error) return fail(error.message, 500);
  await afterChipInVerified(auth.admin, id); // may have closed the gap: charge the card pledges
  return NextResponse.json({ status: "verified" });
}
