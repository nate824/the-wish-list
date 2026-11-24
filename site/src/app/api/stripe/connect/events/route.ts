import { NextResponse } from "next/server";
import { fail } from "@/lib/api";
import { refreshTransfersStatus, releaseHeldGifts, stripe } from "@/lib/payments/stripe";
import { supabaseAdmin } from "@/lib/supabase/server";

// Accounts v2 (thin) events from an event destination. Secret: STRIPE_CONNECT_WEBHOOK_SECRET.
// Subscribe to: v2.core.account[configuration.recipient].capability_status_updated
// When a wisher's account can receive transfers, send any gifts held for them.
export async function POST(req: Request) {
  const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
  if (!secret) return fail("Stripe Connect events not configured.", 501);
  const body = await req.text();
  let note;
  try {
    note = stripe().parseEventNotification(body, req.headers.get("stripe-signature") ?? "", secret);
  } catch {
    return fail("Bad signature.", 400);
  }

  try {
    const related = (note as { related_object?: { id?: string } | null }).related_object;
    if (note.type.startsWith("v2.core.account") && related?.id) {
      const accountId = related.id;
      const admin = supabaseAdmin();
      if (await refreshTransfersStatus(admin, accountId)) {
        const { data: prof } = await admin.from("profiles").select("user_id").eq("stripe_account_id", accountId).maybeSingle();
        if (prof) await releaseHeldGifts(admin, prof.user_id);
      }
    }
  } catch (e) {
    console.error("stripe connect event", note.type, e);
    return fail("Handler failed.", 500);
  }
  return NextResponse.json({ received: true });
}
