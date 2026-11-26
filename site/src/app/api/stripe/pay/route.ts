import { NextResponse } from "next/server";
import { chipInAmount, fail, loadOpenWish, requireBuyer } from "@/lib/api";
import { pledgeCard } from "@/lib/payments/pledges";
import { STRIPE_ENABLED } from "@/lib/payments/stripe";

// Card chip-in (Payment Element in setup mode -> ConfirmationToken). The card is SAVED, not charged:
// it's charged only once the wish is fully covered. See src/lib/payments/pledges.ts.
// The server prices it from the card's country and only proceeds if that matches what the giver saw.
export async function POST(req: Request) {
  if (!STRIPE_ENABLED) return fail("Card payments are coming soon.", 501);
  const auth = await requireBuyer();
  if ("res" in auth) return auth.res;
  const body = (await req.json()) as { wishId?: string; amountCents?: number; confirmationTokenId?: string; expectedTotalCents?: number };
  if (!body.wishId || !body.confirmationTokenId || typeof body.expectedTotalCents !== "number") {
    return fail("Missing payment details.");
  }

  const loaded = await loadOpenWish(auth.admin, body.wishId, auth.user.id);
  if ("res" in loaded) return loaded.res;
  if (!loaded.wish.accepts_stripe) return fail("This wish doesn't take card payments.");
  const amt = await chipInAmount(auth.admin, loaded.wish, body.amountCents);
  if ("res" in amt) return amt.res;

  try {
    const result = await pledgeCard(
      auth.admin, body.wishId, { id: auth.user.id, email: auth.user.email },
      amt.cents, body.confirmationTokenId, body.expectedTotalCents,
    );
    if (result.kind === "declined") return fail(result.message, 402);
    return NextResponse.json(result);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Could not save the card.", 500);
  }
}
