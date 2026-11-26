import { NextResponse } from "next/server";
import { chipInAmount, clientIp, fail, loadOpenWish, requireBuyer } from "@/lib/api";
import { requestInvoice } from "@/lib/payments/lightning";
import { btcUsdPrice, usdCentsToSats } from "@/lib/payments/price";

// Lightning step 1: fetch an invoice from the wisher's Lightning address (server-side).
// TODO: rate-limit per user and per wish (lnurl-checklist #9).
export async function POST(req: Request) {
  const auth = await requireBuyer();
  if ("res" in auth) return auth.res;
  const { wishId, amountCents } = (await req.json()) as { wishId?: string; amountCents?: number };
  if (!wishId) return fail("Missing wish.");
  const w = await loadOpenWish(auth.admin, wishId, auth.user.id);
  if ("res" in w) return w.res;
  if (!w.wish.lightning_address) return fail("This wish doesn't take Lightning.");

  const amt = await chipInAmount(auth.admin, w.wish, amountCents);
  if ("res" in amt) return amt.res;
  const sats = usdCentsToSats(amt.cents, await btcUsdPrice());
  let inv;
  try {
    inv = await requestInvoice(w.wish.lightning_address, sats * 1000, `wishlist:${wishId}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return fail(msg, 502);
  }

  const { data, error } = await auth.admin
    .from("purchases")
    .insert({
      wish_id: wishId, buyer_id: auth.user.id, rail: "lightning", amount_usd_cents: amt.cents,
      btc_amount_sats: sats, ln_invoice: inv.pr, ln_verify_url: inv.verify, ln_payment_hash: inv.paymentHash || null,
      ln_confirm_mode: inv.verify ? "verify" : "wisher", buyer_ip: clientIp(req),
    })
    .select("id").single();
  if (error) return fail(error.message, 500);
  return NextResponse.json({ purchaseId: data.id, invoice: inv.pr, sats, expiresAt: new Date(inv.expiresAt).toISOString(),
    mode: inv.verify ? "verify" : "wisher" });
}
