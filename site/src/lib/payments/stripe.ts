// Stripe Connect rail (marketplace, test mode until Stripe clears the platform).
//
// Money flow: SEPARATE CHARGES AND TRANSFERS (Stripe implementation planner, 2026-11-23).
//   1. Giver pays with the Payment Element on the wish page, charged on the PLATFORM account
//      (cards, Apple Pay, Google Pay). Charge = wish price + card fee. The giver pays the fee,
//      including Stripe's extra fee for non-US cards; the platform never covers it.
//      The card's country is read from a ConfirmationToken BEFORE the PaymentIntent is created,
//      so the international fee is only added when the card really is foreign.
//   2. The gift sits in the platform's Stripe balance, tagged `transfer_group = wish:<id>`.
//   3. Webhook `payment_intent.succeeded` -> purchase 'verified' (the DB trigger marks the wish funded).
//   4. If the wisher's connected account can receive transfers, transfer the full wish price now.
//      If not, it stays held; it's released when they finish onboarding (return URL or the
//      v2 capability-status event).
//
// Connected accounts use Accounts v2 with the `recipient` configuration only (no card_payments,
// no legacy `type: "express"`), Express dashboard, and platform-owned fees and losses.
// The platform is merchant of record: refunds and disputes come out of the platform balance.

import Stripe from "stripe";
import { SITE_NAME, SITE_URL } from "@/lib/config";
import { supabaseAdmin } from "@/lib/supabase/server";

export const STRIPE_ENABLED = !!process.env.STRIPE_SECRET_KEY;

import { giverTotal, wisherFee } from "./fees";
export { CARD_FEE_PERCENT, CARD_FEE_FIXED_CENTS, INTL_CARD_FEE_PERCENT, PLATFORM_FEE_PERCENT, giverTotal, wisherFee } from "./fees";
/** We charge and settle in USD, so Stripe's ~1% currency conversion fee doesn't apply. */
export const HOME_CARD_COUNTRY = "US";

export type CardQuote = ReturnType<typeof giverTotal> & { country: string | null };

/** Reads the card's issuing country from a ConfirmationToken (Payment Element) and prices the gift. */
export async function quoteFromConfirmationToken(priceCents: number, confirmationTokenId: string): Promise<CardQuote> {
  const token = await stripe().confirmationTokens.retrieve(confirmationTokenId);
  const country = token.payment_method_preview?.card?.country ?? null;
  // Unknown country -> treat as domestic (we never charge the extra fee on a guess).
  const international = !!country && country.toUpperCase() !== HOME_CARD_COUNTRY;
  return { ...giverTotal(priceCents, { international }), country };
}

export class StripeNotConfigured extends Error {
  constructor() {
    super("Card payments are coming soon.");
  }
}

let client: Stripe | null = null;
export function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new StripeNotConfigured();
  if (key.startsWith("sk_live_") && process.env.STRIPE_ALLOW_LIVE !== "true") {
    throw new Error("Live Stripe key found but STRIPE_ALLOW_LIVE is not set. Use test keys until launch.");
  }
  client ??= new Stripe(key);
  return client;
}

type Admin = ReturnType<typeof supabaseAdmin>;

// ---------------------------------------------------------------------------
// Card payment (giver side): Payment Element + ConfirmationToken + PaymentIntent
// ---------------------------------------------------------------------------

export type CardPayResult =
  | { kind: "price_changed"; quote: CardQuote }
  | { kind: "succeeded" | "processing"; purchaseId: string }
  | { kind: "requires_action"; purchaseId: string; clientSecret: string }
  | { kind: "declined"; message: string };

/**
 * Prices the gift from the card's country, and charges it only if the total matches what the
 * giver was shown (`expectedTotalCents`). If not (non-US card), returns the new quote so the
 * page can show it and ask again: nobody is charged more than they saw.
 */
export async function payCardGift(
  admin: Admin,
  wish: { id: string; title: string; price_usd_cents: number },
  buyer: { id: string; email?: string | null },
  confirmationTokenId: string,
  expectedTotalCents: number,
): Promise<CardPayResult> {
  const quote = await quoteFromConfirmationToken(wish.price_usd_cents, confirmationTokenId);
  if (quote.totalCents !== expectedTotalCents) return { kind: "price_changed", quote };

  const { data: purchase, error } = await admin
    .from("purchases")
    .insert({
      wish_id: wish.id,
      buyer_id: buyer.id,
      rail: "stripe",
      amount_usd_cents: wish.price_usd_cents,
      fee_usd_cents: quote.feeCents,
      platform_fee_usd_cents: quote.platformFeeCents,
    })
    .select("id")
    .single();
  if (error || !purchase) throw new Error(error?.message ?? "Could not start the purchase.");

  const meta = {
    purchase_id: purchase.id,
    wish_id: wish.id,
    buyer_id: buyer.id,
    card_country: quote.country ?? "",
    international_fee: String(quote.international),
  };
  let pi: Stripe.PaymentIntent;
  try {
    pi = await stripe().paymentIntents.create(
      {
        amount: quote.totalCents,
        currency: "usd",
        allowed_payment_method_types: ["card"], // Apple Pay / Google Pay are cards too
        confirm: true,
        confirmation_token: confirmationTokenId,
        description: `Gift: ${wish.title}`.slice(0, 250),
        receipt_email: buyer.email ?? undefined,
        transfer_group: `wish:${wish.id}`,
        metadata: meta,
        return_url: `${SITE_URL}/wish/${wish.id}?paid=1`,
      },
      { idempotencyKey: `pi-${purchase.id}` },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Card payment failed.";
    await admin.from("purchases").update({ status: "rejected", review_note: `card declined: ${message}` }).eq("id", purchase.id);
    return { kind: "declined", message };
  }

  await admin.from("purchases").update({ stripe_payment_intent_id: pi.id }).eq("id", purchase.id);
  if (pi.status === "succeeded") {
    await markCardGiftPaid(admin, purchase.id, pi.id); // webhook does the same; both are idempotent
    return { kind: "succeeded", purchaseId: purchase.id };
  }
  if (pi.status === "requires_action" && pi.client_secret) {
    return { kind: "requires_action", purchaseId: purchase.id, clientSecret: pi.client_secret };
  }
  if (pi.status === "processing") return { kind: "processing", purchaseId: purchase.id };
  await admin.from("purchases").update({ status: "rejected", review_note: `payment intent ${pi.status}` }).eq("id", purchase.id);
  return { kind: "declined", message: "The card wasn't charged. Try another card." };
}

/** Webhook: payment_intent.succeeded for a card gift. */
export async function handlePaymentIntentSucceeded(admin: Admin, pi: Stripe.PaymentIntent) {
  const purchaseId = pi.metadata?.purchase_id;
  if (!purchaseId) return;
  await markCardGiftPaid(admin, purchaseId, pi.id);
}

/** Webhook: payment_intent.payment_failed (e.g. 3-D Secure failed). */
export async function handlePaymentIntentFailed(admin: Admin, pi: Stripe.PaymentIntent) {
  const purchaseId = pi.metadata?.purchase_id;
  if (!purchaseId) return;
  await admin
    .from("purchases")
    .update({ status: "rejected", review_note: pi.last_payment_error?.message ?? "card payment failed" })
    .eq("id", purchaseId)
    .eq("status", "pending");
}

/** Marks a card gift verified (wish funded, giver's draft published) and sends it on if the wisher is ready. */
async function markCardGiftPaid(admin: Admin, purchaseId: string, paymentIntentId: string) {
  const { data: p } = await admin
    .from("purchases")
    .select("id, status, rail, stripe_payment_intent_id")
    .eq("id", purchaseId)
    .maybeSingle();
  if (!p || p.rail !== "stripe") return;
  if (p.stripe_payment_intent_id && p.stripe_payment_intent_id !== paymentIntentId) return;
  if (p.status === "verified") {
    await transferToWisher(admin, p.id);
    return;
  }
  if (p.status !== "pending") return;

  const { error } = await admin
    .from("purchases")
    .update({ status: "verified", stripe_payment_intent_id: paymentIntentId })
    .eq("id", p.id);
  if (error) {
    // Most likely someone else funded this wish first (one verified payment per wish).
    await admin
      .from("purchases")
      .update({
        status: "review",
        stripe_payment_intent_id: paymentIntentId,
        review_note: `card payment succeeded but could not be verified (${error.message}); refund in Stripe`,
      })
      .eq("id", p.id);
    return;
  }
  await transferToWisher(admin, p.id);
}

// ---------------------------------------------------------------------------
// Hosted Checkout (LEGACY: no longer offered in the UI, because it can't see the card's
// country before the amount is fixed. Kept so sessions created earlier still complete.)
// ---------------------------------------------------------------------------

/** Creates a pending purchase and a hosted Checkout Session for it. */
export async function createCheckoutSession(
  admin: Admin,
  wish: { id: string; title: string; price_usd_cents: number },
  buyer: { id: string; email?: string | null },
): Promise<{ url: string }> {
  const s = stripe();
  const { totalCents, feeCents, platformFeeCents } = giverTotal(wish.price_usd_cents);

  const { data: purchase, error } = await admin
    .from("purchases")
    .insert({
      wish_id: wish.id,
      buyer_id: buyer.id,
      rail: "stripe",
      amount_usd_cents: wish.price_usd_cents,
      fee_usd_cents: feeCents,
      platform_fee_usd_cents: platformFeeCents,
    })
    .select("id")
    .single();
  if (error || !purchase) throw new Error(error?.message ?? "Could not start the purchase.");

  const meta = { purchase_id: purchase.id, wish_id: wish.id, buyer_id: buyer.id };
  const session = await s.checkout.sessions.create(
    {
      mode: "payment",
      customer_email: buyer.email ?? undefined,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: wish.price_usd_cents,
            product_data: { name: `Gift: ${wish.title}`.slice(0, 250), description: `A wish on ${SITE_NAME}` },
          },
        },
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: feeCents,
            product_data: { name: "Card processing + service fee", description: `Stripe's card fee plus 1% for ${SITE_NAME}` },
          },
        },
      ],
      payment_intent_data: { transfer_group: `wish:${wish.id}`, metadata: meta },
      metadata: meta,
      client_reference_id: purchase.id,
      success_url: `${SITE_URL}/wish/${wish.id}?paid=1`,
      cancel_url: `${SITE_URL}/wish/${wish.id}`,
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    },
    { idempotencyKey: `checkout-${purchase.id}` },
  );

  await admin.from("purchases").update({ stripe_checkout_session_id: session.id }).eq("id", purchase.id);
  if (!session.url) throw new Error("Stripe did not return a checkout URL.");
  return { url: session.url };
}

/** Webhook: a Checkout Session finished. Marks the purchase verified once the money is in. */
export async function handleCheckoutCompleted(admin: Admin, session: Stripe.Checkout.Session) {
  const purchaseId = session.metadata?.purchase_id ?? session.client_reference_id;
  if (!purchaseId) return;
  if (session.payment_status !== "paid") return; // async methods: wait for async_payment_succeeded

  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  const { data: p } = await admin
    .from("purchases")
    .select("id, status, rail, stripe_checkout_session_id")
    .eq("id", purchaseId)
    .maybeSingle();
  if (!p || p.rail !== "stripe" || p.stripe_checkout_session_id !== session.id) return;
  if (p.status === "verified") {
    await transferToWisher(admin, p.id);
    return;
  }

  const { error } = await admin
    .from("purchases")
    .update({ status: "verified", stripe_payment_intent_id: paymentIntentId })
    .eq("id", p.id);

  if (error) {
    // Most likely someone else funded this wish first (one verified payment per wish).
    // Money was taken, so park it for an admin to refund.
    await admin
      .from("purchases")
      .update({
        status: "review",
        stripe_payment_intent_id: paymentIntentId,
        review_note: `card payment succeeded but could not be verified (${error.message}); refund in Stripe`,
      })
      .eq("id", p.id);
    return;
  }
  await transferToWisher(admin, p.id);
}

// ---------------------------------------------------------------------------
// Transfers (wisher side)
// ---------------------------------------------------------------------------

/** Can this connected account receive transfers right now? Also caches the answer on the profile. */
export async function refreshTransfersStatus(admin: Admin, accountId: string): Promise<boolean> {
  const account = await stripe().v2.core.accounts.retrieve(accountId, { include: ["configuration.recipient"] });
  const status = account.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status;
  const active = status === "active";
  await admin.from("profiles").update({ stripe_transfers_active: active }).eq("stripe_account_id", accountId);
  return active;
}

/**
 * Sends a verified card gift to the wisher if their account can receive it.
 * Returns "held" when the wisher hasn't finished payout setup yet. Safe to call repeatedly.
 */
export async function transferToWisher(admin: Admin, purchaseId: string): Promise<"sent" | "held" | "skipped"> {
  const { data: p } = await admin
    .from("purchases")
    .select("id, rail, status, amount_usd_cents, stripe_transfer_id, stripe_payment_intent_id, wish_id, wishes!purchases_wish_id_fkey(user_id)")
    .eq("id", purchaseId)
    .maybeSingle();
  if (!p || p.rail !== "stripe" || p.status !== "verified" || p.stripe_transfer_id || !p.stripe_payment_intent_id) {
    return "skipped";
  }
  const wisherId = (p.wishes as unknown as { user_id: string }).user_id;
  const { data: prof } = await admin
    .from("profiles")
    .select("stripe_account_id")
    .eq("user_id", wisherId)
    .maybeSingle();
  if (!prof?.stripe_account_id) return "held";
  if (!(await refreshTransfersStatus(admin, prof.stripe_account_id))) return "held";

  const s = stripe();
  const pi = await s.paymentIntents.retrieve(p.stripe_payment_intent_id);
  const chargeId = typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge?.id;

  // Stripe's Connect costs come out of the gift: 0.25% + 25c, plus $2 on the wisher's first payout this month.
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const { count: paidThisMonth } = await admin
    .from("purchases")
    .select("id, wishes!purchases_wish_id_fkey!inner(user_id)", { count: "exact", head: true })
    .eq("rail", "stripe")
    .not("stripe_transfer_id", "is", null)
    .gte("transferred_at", monthStart.toISOString())
    .eq("wishes.user_id", wisherId);
  const fee = wisherFee(p.amount_usd_cents, { firstThisMonth: !paidThisMonth });

  const transfer = await s.transfers.create(
    {
      amount: fee.receiveCents, // wish price minus Stripe's payout costs; the giver's fees stay with the platform
      currency: "usd",
      destination: prof.stripe_account_id,
      transfer_group: `wish:${p.wish_id}`,
      source_transaction: chargeId, // transfer as soon as the charge's funds are available
      metadata: { purchase_id: p.id, wish_id: p.wish_id, wisher_fee_cents: String(fee.feeCents) },
    },
    { idempotencyKey: `transfer-${p.id}` },
  );
  await admin
    .from("purchases")
    .update({ stripe_transfer_id: transfer.id, transferred_at: new Date().toISOString(), wisher_fee_usd_cents: fee.feeCents })
    .eq("id", p.id)
    .is("stripe_transfer_id", null);
  return "sent";
}

/** Sends every held card gift for this wisher. Used after onboarding finishes. */
export async function releaseHeldGifts(admin: Admin, wisherId: string): Promise<number> {
  const { data: held } = await admin
    .from("purchases")
    .select("id, wishes!purchases_wish_id_fkey!inner(user_id)")
    .eq("rail", "stripe")
    .eq("status", "verified")
    .is("stripe_transfer_id", null)
    .eq("wishes.user_id", wisherId);
  let sent = 0;
  for (const row of held ?? []) {
    if ((await transferToWisher(admin, row.id)) === "sent") sent++;
  }
  return sent;
}

// ---------------------------------------------------------------------------
// Onboarding (wisher side)
// ---------------------------------------------------------------------------

/** Gets or creates the wisher's connected account (Accounts v2, recipient only). */
export async function ensureConnectedAccount(admin: Admin, user: { id: string; email?: string | null }) {
  const { data: prof } = await admin.from("profiles").select("stripe_account_id, display_name").eq("user_id", user.id).maybeSingle();
  if (prof?.stripe_account_id) return prof.stripe_account_id as string;

  const account = await stripe().v2.core.accounts.create(
    {
      contact_email: user.email ?? undefined,
      display_name: prof?.display_name || "Wisher",
      dashboard: "express",
      identity: { country: "us" },
      defaults: { responsibilities: { fees_collector: "application", losses_collector: "application" } },
      configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } } },
      metadata: { user_id: user.id },
    },
    { idempotencyKey: `account-${user.id}` },
  );
  await admin.from("profiles").update({ stripe_account_id: account.id }).eq("user_id", user.id);
  return account.id;
}

/** Stripe-hosted onboarding link for the signed-in wisher. */
export async function onboardingLink(admin: Admin, user: { id: string; email?: string | null }): Promise<{ url: string }> {
  const accountId = await ensureConnectedAccount(admin, user);
  const link = await stripe().v2.core.accountLinks.create({
    account: accountId,
    use_case: {
      type: "account_onboarding",
      account_onboarding: {
        refresh_url: `${SITE_URL}/api/stripe/connect/onboard`,
        return_url: `${SITE_URL}/api/stripe/connect/return`,
      },
    },
  });
  return { url: link.url };
}

/** Express dashboard login so a wisher can see payouts. */
export async function dashboardLink(accountId: string): Promise<{ url: string }> {
  const link = await stripe().accounts.createLoginLink(accountId);
  return { url: link.url };
}
