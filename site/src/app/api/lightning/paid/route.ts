import { NextResponse } from "next/server";
import { fail, requireBuyer } from "@/lib/api";

// Buyer says "I paid" on a wish whose Lightning wallet has no verify (wisher-confirm mode).
// This only tells the wisher to check; it doesn't verify anything.
export async function POST(req: Request) {
  const auth = await requireBuyer();
  if ("res" in auth) return auth.res;
  const { purchaseId } = (await req.json()) as { purchaseId?: string };
  if (!purchaseId) return fail("Missing purchase.");
  const { data: p } = await auth.admin
    .from("purchases").select("id, buyer_id, status, ln_confirm_mode").eq("id", purchaseId).maybeSingle();
  if (!p || p.buyer_id !== auth.user.id) return fail("Purchase not found.", 404);
  if (p.ln_confirm_mode !== "wisher") return fail("This gift confirms automatically.");
  if (p.status !== "pending") return NextResponse.json({ status: p.status });
  const { error } = await auth.admin
    .from("purchases").update({ paid_claimed_at: new Date().toISOString() }).eq("id", purchaseId).eq("status", "pending");
  if (error) return fail(error.message, 500);
  // TODO: email the wisher "someone sent you a gift, confirm it" once Resend is wired.
  return NextResponse.json({ status: "awaiting_wisher" });
}
