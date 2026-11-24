import { NextResponse } from "next/server";
import { SITE_URL } from "@/lib/config";
import { requireBuyer } from "@/lib/api";
import { refreshTransfersStatus, releaseHeldGifts } from "@/lib/payments/stripe";

// Wisher is back from Stripe onboarding. Check the account and send any held gifts.
export async function GET() {
  const auth = await requireBuyer();
  if ("res" in auth) return NextResponse.redirect(`${SITE_URL}/login?next=/payouts`);
  const { data: prof } = await auth.admin.from("profiles").select("stripe_account_id").eq("user_id", auth.user.id).maybeSingle();
  if (!prof?.stripe_account_id) return NextResponse.redirect(`${SITE_URL}/payouts`);
  try {
    if (await refreshTransfersStatus(auth.admin, prof.stripe_account_id)) {
      const sent = await releaseHeldGifts(auth.admin, auth.user.id);
      return NextResponse.redirect(`${SITE_URL}/payouts?ready=1&sent=${sent}`);
    }
  } catch (e) {
    console.error("stripe onboarding return", e);
  }
  return NextResponse.redirect(`${SITE_URL}/payouts?pending=1`);
}
