// Pooled card gifts (Nate, 2026-11-25).
//
// A card chip-in is a PLEDGE, not a charge:
//   1. Giver picks an amount and enters a card (Payment Element in setup mode -> ConfirmationToken).
//   2. Server prices it from the card's country (same fee rules as before, on the chip-in amount),
//      then saves the card with a SetupIntent (usage: off_session). Nothing is charged.
//   3. add_pledge() records it, locking the wish so the last dollars can't be over-pledged.
//      The first pledge starts the wish's funding window (14 days, app_settings).
//   4. As soon as verified money + pledges cover the price, every pledge is charged off-session.
//      Charged money follows the normal card path: verified -> transfer to the wisher.
//   5. If the window runs out first, pledges expire and the saved cards are detached. Nobody is charged.
//
// We never hold card money waiting for a wish to fill, so there's nothing to refund and no escrow.
// One honest edge: if a card is declined at the end, the others have already been charged.
// That money still goes to the wisher, and the gap reopens for new chip-ins.

import type Stripe from "stripe";
import { SITE_URL } from "@/lib/config";
import { supabaseAdmin } from "@/lib/supabase/server";
import { markCardGiftPaid, quoteFromConfirmationToken, stripe, type CardQuote } from "./stripe";

type Admin = ReturnType<typeof supabaseAdmin>;

export type PledgeResult =
  | { kind: "price_changed"; quote: CardQuote }
  | { kind: "requires_action"; clientSecret: string; setupIntentId: string }
  | { kind: "pledged"; purchaseId: string; funded: boolean }
  | { kind: "declined"; message: string };

/** Gets or creates the giver's Stripe Customer (saved cards hang off it). */
export async function ensureCustomer(admin: Admin, user: { id: string; email?: string | null }) {
  const { data: prof } = await admin.from("profiles").select("stripe_customer_id").eq("user_id", user.id).maybeSingle();
  if (prof?.stripe_customer_id) return prof.stripe_customer_id as string;
  const customer = await stripe().customers.create(
    { email: user.email ?? undefined, metadata: { user_id: user.id } },
    { idempotencyKey: `customer-${user.id}` },
  );
  await admin.from("profiles").update({ stripe_customer_id: customer.id }).eq("user_id", user.id);
  return customer.id;
}

/** Step 2: price the chip-in from the card's country and save the card. */
export async function pledgeCard(
  admin: Admin,
  wishId: string,
  buyer: { id: string; email?: string | null },
  amountCents: number,
  confirmationTokenId: string,
  expectedTotalCents: number,
): Promise<PledgeResult> {
  const quote = await quoteFromConfirmationToken(amountCents, confirmationTokenId);
  if (quote.totalCents !== expectedTotalCents) return { kind: "price_changed", quote };

  const customer = await ensureCustomer(admin, buyer);
  let si: Stripe.SetupIntent;
  try {
    si = await stripe().setupIntents.create({
      customer,
      confirm: true,
      confirmation_token: confirmationTokenId,
      usage: "off_session",
      allowed_payment_method_types: ["card"],
      return_url: `${SITE_URL}/wish/${wishId}?pledged=1`,
      metadata: {
        kind: "pledge",
        wish_id: wishId,
        buyer_id: buyer.id,
        amount_cents: String(amountCents),
        fee_cents: String(quote.feeCents),
        platform_fee_cents: String(quote.platformFeeCents),
        card_country: quote.country ?? "",
      },
    });
  } catch (e) {
    return { kind: "declined", message: e instanceof Error ? e.message : "Card couldn't be saved." };
  }

  if (si.status === "requires_action" && si.client_secret) {
    return { kind: "requires_action", clientSecret: si.client_secret, setupIntentId: si.id };
  }
  if (si.status !== "succeeded") return { kind: "declined", message: "The card couldn't be saved. Try another card." };
  return finalizePledge(admin, si, buyer.id);
}

/**
 * Step 3: record a saved card as a pledge, then charge everyone if the wish is now covered.
 * Called right after setup, after 3-D Secure (client), and from the setup_intent.succeeded webhook.
 * Idempotent on the SetupIntent.
 */
export async function finalizePledge(admin: Admin, siOrId: Stripe.SetupIntent | string, buyerId?: string): Promise<PledgeResult> {
  const si = typeof siOrId === "string" ? await stripe().setupIntents.retrieve(siOrId) : siOrId;
  const m = si.metadata ?? {};
  if (m.kind !== "pledge" || !m.wish_id || !m.buyer_id) return { kind: "declined", message: "Not a pledge." };
  if (buyerId && m.buyer_id !== buyerId) return { kind: "declined", message: "Not your pledge." };
  if (si.status !== "succeeded") return { kind: "declined", message: "The card wasn't confirmed." };
  const pm = typeof si.payment_method === "string" ? si.payment_method : si.payment_method?.id;
  const customer = typeof si.customer === "string" ? si.customer : si.customer?.id;
  if (!pm || !customer) return { kind: "declined", message: "The card wasn't saved." };

  const { data: purchaseId, error } = await admin.rpc("add_pledge", {
    p_wish_id: m.wish_id,
    p_buyer_id: m.buyer_id,
    p_amount: Number(m.amount_cents),
    p_fee: Number(m.fee_cents),
    p_platform_fee: Number(m.platform_fee_cents),
    p_customer: customer,
    p_payment_method: pm,
    p_setup_intent: si.id,
  });
  if (error || !purchaseId) {
    // Someone else filled it first, or the amount no longer fits. Forget the card.
    await stripe().paymentMethods.detach(pm).catch(() => {});
    return { kind: "declined", message: friendlyPledgeError(error?.message) };
  }

  const funded = await chargeWishIfCovered(admin, m.wish_id);
  return { kind: "pledged", purchaseId: purchaseId as string, funded };
}

function friendlyPledgeError(msg = "") {
  if (msg.includes("FILLED")) return "Someone just covered this wish. Your card wasn't charged.";
  if (msg.includes("TOO_MUCH")) return msg.replace(/^.*TOO_MUCH: /, "") + ". Your card wasn't charged.";
  if (msg.includes("TOO_LITTLE")) return msg.replace(/^.*TOO_LITTLE: /, "");
  if (msg.includes("own wish")) return "You can't fund your own wish.";
  return msg || "Couldn't record your pledge. Your card wasn't charged.";
}

/**
 * If verified money + pledges now cover the wish, charge every outstanding pledge off-session.
 * Safe to call any time, from anywhere: each pledge is claimed (pledged -> charging) before it's
 * charged, so two callers can't charge it twice. Returns true if the wish ended up funded.
 */
export async function chargeWishIfCovered(admin: Admin, wishId: string): Promise<boolean> {
  const { data: w } = await admin
    .from("wishes")
    .select("id, title, status, price_usd_cents, collected_usd_cents, pledged_usd_cents")
    .eq("id", wishId)
    .maybeSingle();
  if (!w) return false;
  if (w.status === "funded") return true;
  if (w.status !== "open" || w.collected_usd_cents + w.pledged_usd_cents < w.price_usd_cents) return false;

  const { data: pledges } = await admin
    .from("purchases")
    .select("id")
    .eq("wish_id", wishId)
    .eq("status", "pledged");
  for (const row of pledges ?? []) {
    const { data: claimed } = await admin
      .from("purchases")
      .update({ status: "charging" })
      .eq("id", row.id)
      .eq("status", "pledged")
      .select("id, buyer_id, amount_usd_cents, fee_usd_cents, stripe_customer_id, stripe_payment_method_id")
      .maybeSingle();
    if (claimed) await chargePledge(admin, w, claimed);
  }

  const { data: after } = await admin.from("wishes").select("status").eq("id", wishId).maybeSingle();
  return after?.status === "funded";
}

type ClaimedPledge = {
  id: string; buyer_id: string; amount_usd_cents: number; fee_usd_cents: number;
  stripe_customer_id: string | null; stripe_payment_method_id: string | null;
};

async function chargePledge(admin: Admin, wish: { id: string; title: string }, p: ClaimedPledge) {
  const fail = (note: string) =>
    admin.from("purchases")
      .update({ status: "rejected", charge_failed_at: new Date().toISOString(), review_note: `pledge charge failed: ${note}` })
      .eq("id", p.id)
      .eq("status", "charging");

  if (!p.stripe_customer_id || !p.stripe_payment_method_id) {
    await fail("no saved card");
    return;
  }
  let pi: Stripe.PaymentIntent;
  try {
    pi = await stripe().paymentIntents.create(
      {
        amount: p.amount_usd_cents + p.fee_usd_cents,
        currency: "usd",
        customer: p.stripe_customer_id,
        payment_method: p.stripe_payment_method_id,
        off_session: true,
        confirm: true,
        description: `Gift (pooled): ${wish.title}`.slice(0, 250),
        transfer_group: `wish:${wish.id}`,
        metadata: { purchase_id: p.id, wish_id: wish.id, buyer_id: p.buyer_id, pledge: "true" },
      },
      { idempotencyKey: `pledge-charge-${p.id}` },
    );
  } catch (e) {
    // authentication_required, card_declined, expired_card, ...
    const err = e as { code?: string; message?: string; raw?: { payment_intent?: { id?: string } } };
    const piId = err.raw?.payment_intent?.id;
    if (piId) await admin.from("purchases").update({ stripe_payment_intent_id: piId }).eq("id", p.id);
    await fail(err.code ?? err.message ?? "declined");
    return;
  }

  await admin.from("purchases").update({ stripe_payment_intent_id: pi.id }).eq("id", p.id);
  if (pi.status === "succeeded") await markCardGiftPaid(admin, p.id, pi.id);
  else if (pi.status !== "processing") await fail(`payment intent ${pi.status}`);
  // processing: the payment_intent.succeeded / payment_failed webhook finishes it.
}

/** Detach saved cards from expired pledges (they'll never be charged). */
async function releaseExpiredCards(admin: Admin) {
  const { data } = await admin
    .from("purchases")
    .select("id, stripe_payment_method_id")
    .eq("status", "expired")
    .is("card_released_at", null)
    .not("stripe_payment_method_id", "is", null)
    .limit(100);
  for (const row of data ?? []) {
    await stripe().paymentMethods.detach(row.stripe_payment_method_id!).catch(() => {});
    await admin.from("purchases").update({ card_released_at: new Date().toISOString() }).eq("id", row.id);
  }
}

/**
 * Housekeeping: expire pledges past their window, release those cards, and charge any wish that's
 * covered but wasn't charged yet (e.g. a Bitcoin chip-in closed the gap). Run from the cron route
 * and lazily from wish pages.
 */
export async function sweepPledges(admin: Admin, onlyWishId?: string) {
  const { data: expired } = await admin.rpc("expire_stale_pledges");
  if (process.env.STRIPE_SECRET_KEY) await releaseExpiredCards(admin);

  let q = admin.from("wishes").select("id, price_usd_cents, collected_usd_cents, pledged_usd_cents")
    .eq("status", "open").gt("pledged_usd_cents", 0);
  if (onlyWishId) q = q.eq("id", onlyWishId);
  const { data: wishes } = await q.limit(200);
  let charged = 0;
  for (const w of wishes ?? []) {
    if (w.collected_usd_cents + w.pledged_usd_cents >= w.price_usd_cents) {
      await chargeWishIfCovered(admin, w.id);
      charged++;
    }
  }
  return { expired: (expired as number) ?? 0, charged };
}

/** Call after any chip-in becomes verified (crypto, admin approval): it may have closed the gap. */
export async function afterChipInVerified(admin: Admin, purchaseId: string) {
  try {
    const { data } = await admin.from("purchases").select("wish_id").eq("id", purchaseId).maybeSingle();
    if (data?.wish_id && process.env.STRIPE_SECRET_KEY) await chargeWishIfCovered(admin, data.wish_id);
  } catch (e) {
    console.error("afterChipInVerified", e); // the sweep picks it up later
  }
}
