import { NextResponse } from "next/server";
import { SITE_URL } from "@/lib/config";
import { requireBuyer } from "@/lib/api";
import { dashboardLink } from "@/lib/payments/stripe";

// GET: open the wisher's Express dashboard (payout history, bank details).
export async function GET() {
  const auth = await requireBuyer();
  if ("res" in auth) return NextResponse.redirect(`${SITE_URL}/login?next=/payouts`);
  const { data: prof } = await auth.admin.from("profiles").select("stripe_account_id").eq("user_id", auth.user.id).maybeSingle();
  if (!prof?.stripe_account_id) return NextResponse.redirect(`${SITE_URL}/payouts`);
  try {
    const { url } = await dashboardLink(prof.stripe_account_id);
    return NextResponse.redirect(url);
  } catch {
    return NextResponse.redirect(`${SITE_URL}/payouts?error=1`);
  }
}
