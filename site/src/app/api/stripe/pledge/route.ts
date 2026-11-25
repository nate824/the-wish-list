import { NextResponse } from "next/server";
import { fail, requireBuyer } from "@/lib/api";
import { finalizePledge } from "@/lib/payments/pledges";
import { STRIPE_ENABLED } from "@/lib/payments/stripe";

// After 3-D Secure on a card chip-in: the page sends the SetupIntent id back so the pledge is recorded.
// (The setup_intent.succeeded webhook does the same if the giver closes the tab.)
export async function POST(req: Request) {
  if (!STRIPE_ENABLED) return fail("Card payments are coming soon.", 501);
  const auth = await requireBuyer();
  if ("res" in auth) return auth.res;
  const { setupIntentId } = (await req.json()) as { setupIntentId?: string };
  if (!setupIntentId) return fail("Missing setup.");
  try {
    const result = await finalizePledge(auth.admin, setupIntentId, auth.user.id);
    if (result.kind === "declined") return fail(result.message, 402);
    return NextResponse.json(result);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Could not record the pledge.", 500);
  }
}
