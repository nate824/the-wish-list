import { NextResponse } from "next/server";
import { QUOTE_LOCK_MINUTES } from "@/lib/config";
import { chipInAmount, fail, loadOpenWish, requireBuyer } from "@/lib/api";
import { btcUsdPrice, usdCentsToSats } from "@/lib/payments/price";

// Step 1: lock a USD->sats quote for 15 minutes and open a pending purchase.
export async function POST(req: Request) {
  const auth = await requireBuyer();
  if ("res" in auth) return auth.res;
  const { wishId, amountCents } = (await req.json()) as { wishId?: string; amountCents?: number };
  if (!wishId) return fail("Missing wish.");
  const w = await loadOpenWish(auth.admin, wishId, auth.user.id);
  if ("res" in w) return w.res;
  if (!w.wish.btc_address) return fail("This wish doesn't take Bitcoin.");
  const amt = await chipInAmount(auth.admin, w.wish, amountCents);
  if ("res" in amt) return amt.res;

  // reuse a still-valid pending quote
  const since = new Date(Date.now() - QUOTE_LOCK_MINUTES * 60_000).toISOString();
  const { data: existing } = await auth.admin
    .from("purchases")
    .select("id, btc_amount_sats, quoted_at")
    .eq("wish_id", wishId).eq("buyer_id", auth.user.id).eq("rail", "btc").eq("status", "pending")
    .eq("amount_usd_cents", amt.cents)
    .is("txid", null).gte("quoted_at", since)
    .order("quoted_at", { ascending: false }).limit(1).maybeSingle();

  let purchase = existing;
  if (!purchase) {
    const price = await btcUsdPrice();
    const sats = usdCentsToSats(amt.cents, price);
    const { data, error } = await auth.admin
      .from("purchases")
      .insert({ wish_id: wishId, buyer_id: auth.user.id, rail: "btc", amount_usd_cents: amt.cents, btc_amount_sats: sats })
      .select("id, btc_amount_sats, quoted_at").single();
    if (error) return fail(error.message, 500);
    purchase = data;
  }

  return NextResponse.json({
    purchaseId: purchase.id,
    address: w.wish.btc_address,
    sats: purchase.btc_amount_sats,
    expiresAt: new Date(new Date(purchase.quoted_at).getTime() + QUOTE_LOCK_MINUTES * 60_000).toISOString(),
  });
}
