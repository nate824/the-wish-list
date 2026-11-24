import { NextResponse } from "next/server";
import { fail, requireBuyer } from "@/lib/api";
import { checkTx, claimMessage } from "@/lib/payments/btc";

// Step 2: buyer pastes txid. We check the chain and hand back the message to sign.
export async function POST(req: Request) {
  const auth = await requireBuyer();
  if ("res" in auth) return auth.res;
  const { purchaseId, txid } = (await req.json()) as { purchaseId?: string; txid?: string };
  if (!purchaseId || !txid) return fail("Missing purchase or txid.");
  const cleanTxid = txid.trim().toLowerCase();

  const { data: p } = await auth.admin
    .from("purchases")
    .select("id, buyer_id, status, nonce, btc_amount_sats, wishes!purchases_wish_id_fkey(btc_address, status)")
    .eq("id", purchaseId).maybeSingle();
  if (!p || p.buyer_id !== auth.user.id) return fail("Purchase not found.", 404);
  if (p.status !== "pending") return fail("This purchase is already being handled.", 409);
  const wish = p.wishes as unknown as { btc_address: string; status: string };

  const { data: dupe } = await auth.admin.from("purchases").select("id").eq("txid", cleanTxid).neq("id", purchaseId).maybeSingle();
  if (dupe) return fail("That transaction has already been used for a gift.", 409);

  const check = await checkTx(cleanTxid, wish.btc_address, Number(p.btc_amount_sats));
  if (!check.ok) return fail(check.reason);

  const message = claimMessage(cleanTxid, p.nonce);
  const { error } = await auth.admin.from("purchases").update({ txid: cleanTxid, signed_message: message }).eq("id", purchaseId);
  if (error) return fail(error.code === "23505" ? "That transaction has already been used." : error.message, 409);

  return NextResponse.json({ message, inputAddresses: check.inputAddresses, confirmed: check.confirmed });
}
