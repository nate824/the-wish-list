import { NextResponse } from "next/server";
import { fail, requireBuyer } from "@/lib/api";
import { checkTx, verifyClaimSignature } from "@/lib/payments/btc";
import { afterChipInVerified } from "@/lib/payments/pledges";

// Step 3: buyer signs the claim message with one of the tx's input addresses (BIP-322).
// Can't sign (exchange withdrawals)? -> manual review queue.
// DECISION: accept 0-conf. The tx was already checked on step 2; admins can reject later.
export async function POST(req: Request) {
  const auth = await requireBuyer();
  if ("res" in auth) return auth.res;
  const body = (await req.json()) as { purchaseId?: string; address?: string; signature?: string; cantSign?: boolean };
  if (!body.purchaseId) return fail("Missing purchase.");

  const { data: p } = await auth.admin
    .from("purchases")
    .select("id, buyer_id, status, txid, signed_message, btc_amount_sats, wishes!purchases_wish_id_fkey(btc_address)")
    .eq("id", body.purchaseId).maybeSingle();
  if (!p || p.buyer_id !== auth.user.id) return fail("Purchase not found.", 404);
  if (p.status !== "pending" || !p.txid || !p.signed_message) return fail("Paste your transaction id first.", 409);

  if (body.cantSign) {
    await auth.admin.from("purchases").update({ status: "review", review_note: "buyer could not sign" }).eq("id", p.id);
    return NextResponse.json({ status: "review" });
  }

  const address = (body.address ?? "").trim();
  const wish = p.wishes as unknown as { btc_address: string };
  const tx = await checkTx(p.txid, wish.btc_address, Number(p.btc_amount_sats));
  if (!tx.ok) return fail(tx.reason);
  if (!tx.inputAddresses.includes(address)) return fail("Sign with an address that funded this transaction.");
  if (!verifyClaimSignature(address, p.signed_message, body.signature ?? "")) {
    return fail("That signature doesn't check out for this address and message.");
  }

  const { error } = await auth.admin
    .from("purchases")
    .update({ status: "verified", sender_address: address, signature: body.signature })
    .eq("id", p.id);
  if (error) return fail(error.message, 500);
  await afterChipInVerified(auth.admin, p.id); // may have closed the gap: charge the card pledges
  return NextResponse.json({ status: "verified" });
}
