import { NextResponse } from "next/server";
import { fail, loadOpenWish, requireBuyer } from "@/lib/api";
import { STRIPE_ENABLED, payCardGift } from "@/lib/payments/stripe";

// Giver pays a card gift from the wish page (Payment Element -> ConfirmationToken).
// The server prices it from the card's country (non-US cards add Stripe's 1.5% international fee)
// and only charges if that matches the total the giver was shown.
export async function POST(req: Request) {
  if (!STRIPE_ENABLED) return fail("Card payments are coming soon.", 501);
  const auth = await requireBuyer();
  if ("res" in auth) return auth.res;
  const body = (await req.json()) as { wishId?: string; confirmationTokenId?: string; expectedTotalCents?: number };
  if (!body.wishId || !body.confirmationTokenId || typeof body.expectedTotalCents !== "number") {
    return fail("Missing payment details.");
  }

  const loaded = await loadOpenWish(auth.admin, body.wishId, auth.user.id);
  if ("res" in loaded) return loaded.res;
  if (!loaded.wish.accepts_stripe) return fail("This wish doesn't take card payments.");

  const { data: w } = await auth.admin.from("wishes").select("title").eq("id", body.wishId).single();
  try {
    const result = await payCardGift(
      auth.admin,
      { id: body.wishId, title: w?.title ?? "A wish", price_usd_cents: loaded.wish.price_usd_cents },
      { id: auth.user.id, email: auth.user.email },
      body.confirmationTokenId,
      body.expectedTotalCents,
    );
    if (result.kind === "declined") return fail(result.message, 402);
    return NextResponse.json(result);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Could not take the card payment.", 500);
  }
}
