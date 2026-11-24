import { NextResponse } from "next/server";
import { clientIp, fail, requireBuyer } from "@/lib/api";

// Wisher confirms (or denies) a Lightning gift sent to a no-verify wallet. Guards live in
// confirm_ln_gift() (migration 0005): risky confirmations go to admin review, not verified.
export async function POST(req: Request) {
  const auth = await requireBuyer();
  if ("res" in auth) return auth.res;
  const { purchaseId, received } = (await req.json()) as { purchaseId?: string; received?: boolean };
  if (!purchaseId || typeof received !== "boolean") return fail("Missing purchase.");
  const { data, error } = await auth.admin.rpc("confirm_ln_gift", {
    p_purchase_id: purchaseId, p_wisher_id: auth.user.id, p_received: received, p_wisher_ip: clientIp(req),
  });
  if (error) return fail(error.message, 400);
  return NextResponse.json({ status: data });
}
