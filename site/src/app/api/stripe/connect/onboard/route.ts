import { NextResponse } from "next/server";
import { SITE_URL } from "@/lib/config";
import { requireBuyer } from "@/lib/api";
import { STRIPE_ENABLED, onboardingLink } from "@/lib/payments/stripe";

// GET: send the signed-in wisher to Stripe-hosted payout setup. Also the Account Link refresh_url,
// so an expired link just makes a fresh one.
export async function GET() {
  if (!STRIPE_ENABLED) return NextResponse.redirect(`${SITE_URL}/payouts`);
  const auth = await requireBuyer();
  if ("res" in auth) return NextResponse.redirect(`${SITE_URL}/login?next=/payouts`);
  try {
    const { url } = await onboardingLink(auth.admin, { id: auth.user.id, email: auth.user.email });
    return NextResponse.redirect(url);
  } catch (e) {
    console.error("stripe onboarding", e);
    return NextResponse.redirect(`${SITE_URL}/payouts?error=1`);
  }
}
