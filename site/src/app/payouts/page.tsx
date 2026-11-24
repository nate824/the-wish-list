import Link from "next/link";
import { redirect } from "next/navigation";
import { DEMO_MODE, usd } from "@/lib/config";
import { getMe } from "@/lib/data";
import { STRIPE_ENABLED } from "@/lib/payments/stripe";
import { supabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Wisher payout setup for card gifts (Stripe Connect). Gifts wait in Stripe until this is done.
export default async function PayoutsPage({ searchParams }: {
  searchParams: Promise<{ ready?: string; sent?: string; pending?: string; error?: string }>;
}) {
  const q = await searchParams;
  if (DEMO_MODE || !STRIPE_ENABLED) {
    return <div style={{ maxWidth: 560, margin: "40px auto" }} className="notice">Card payouts are coming soon.</div>;
  }
  const me = await getMe();
  if (!me) redirect("/login?next=/payouts");

  const admin = supabaseAdmin();
  const [{ data: prof }, { data: held }] = await Promise.all([
    admin.from("profiles").select("stripe_account_id, stripe_transfers_active").eq("user_id", me.id).maybeSingle(),
    admin
      .from("purchases")
      .select("amount_usd_cents, wishes!purchases_wish_id_fkey!inner(user_id)")
      .eq("rail", "stripe")
      .eq("status", "verified")
      .is("stripe_transfer_id", null)
      .eq("wishes.user_id", me.id),
  ]);
  const heldCents = (held ?? []).reduce((sum, r) => sum + r.amount_usd_cents, 0);
  const ready = !!prof?.stripe_transfers_active;

  return (
    <div style={{ maxWidth: 560, margin: "40px auto" }} className="stack">
      <h1 style={{ margin: 0 }}>Card gift payouts</h1>
      {q.ready && <div className="notice ok">You&apos;re set up. {Number(q.sent) > 0 ? `We sent ${q.sent} waiting gift(s) to your account.` : ""}</div>}
      {q.pending && <div className="notice">Stripe is still checking your details. Your gifts stay safe and we&apos;ll send them as soon as it&apos;s done.</div>}
      {q.error && <div className="notice err">Something went wrong talking to Stripe. Try again in a minute.</div>}

      {heldCents > 0 && !ready && (
        <div className="notice ok">You have {usd(heldCents)} in card gifts waiting. Set up payouts to receive it.</div>
      )}

      <div className="panel stack">
        {ready ? (
          <>
            <div>Payouts are on. New card gifts go straight to your Stripe account, then to your bank.</div>
            <Link className="btn secondary" href="/api/stripe/connect/dashboard">See payouts on Stripe</Link>
            <div className="hint">Stripe&apos;s payout fees (0.25% + 25¢ per gift, plus $2 in any month you get paid) come out of each gift. <Link href="/fees">Fees</Link></div>
          </>
        ) : (
          <>
            <div>
              Card gifts are paid out by Stripe. Setup takes a few minutes: your name, date of birth,
              the last 4 of your SSN, and a bank account. You enter those on Stripe&apos;s site, not ours.
            </div>
            <Link className="btn" href="/api/stripe/connect/onboard">
              {prof?.stripe_account_id ? "Finish payout setup" : "Set up payouts"}
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
