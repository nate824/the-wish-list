import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { fail } from "@/lib/api";
import { handleCheckoutCompleted, handlePaymentIntentFailed, handlePaymentIntentSucceeded, stripe } from "@/lib/payments/stripe";
import { finalizePledge } from "@/lib/payments/pledges";
import { supabaseAdmin } from "@/lib/supabase/server";

// Platform (v1, snapshot) events. Endpoint secret: STRIPE_WEBHOOK_SECRET
// (`stripe listen --forward-to localhost:3000/api/stripe/webhook` prints one for local dev).
//   payment_intent.succeeded      -> card gift verified, transfer if the wisher is ready
//   payment_intent.payment_failed -> pending card gift rejected / pledge charge failed (gap reopens)
//   setup_intent.succeeded        -> card chip-in saved after 3-D Secure -> pledge recorded
//   checkout.session.completed / async_payment_succeeded -> legacy hosted Checkout sessions
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return fail("Stripe webhook not configured.", 501);
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(body, req.headers.get("stripe-signature") ?? "", secret);
  } catch {
    return fail("Bad signature.", 400);
  }

  try {
    switch (event.type) {
      case "payment_intent.succeeded":
        await handlePaymentIntentSucceeded(supabaseAdmin(), event.data.object);
        break;
      case "payment_intent.payment_failed":
        await handlePaymentIntentFailed(supabaseAdmin(), event.data.object);
        break;
      case "setup_intent.succeeded":
        // Card chip-in saved after 3-D Secure, in case the giver closed the tab before we heard back.
        if (event.data.object.metadata?.kind === "pledge") await finalizePledge(supabaseAdmin(), event.data.object);
        break;
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        await handleCheckoutCompleted(supabaseAdmin(), event.data.object);
        break;
    }
  } catch (e) {
    console.error("stripe webhook", event.type, e);
    return fail("Webhook handler failed.", 500); // Stripe retries
  }
  return NextResponse.json({ received: true });
}
