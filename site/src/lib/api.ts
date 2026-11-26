import { NextResponse } from "next/server";
import { DEMO_MODE } from "./config";
import { supabaseAdmin, supabaseServer } from "./supabase/server";

export function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/** Signed-in user + service-role client, or an error response. */
export async function requireBuyer() {
  if (DEMO_MODE) return { res: fail("Payments are off in demo mode.", 503) } as const;
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { res: fail("Sign in first.", 401) } as const;
  return { user, admin: supabaseAdmin() } as const;
}

export type WishRow = {
  id: string; user_id: string; status: string; price_usd_cents: number;
  collected_usd_cents: number; pledged_usd_cents: number;
  btc_address: string | null; lightning_address: string | null; accepts_stripe: boolean;
};

export async function loadOpenWish(admin: ReturnType<typeof supabaseAdmin>, wishId: string, buyerId: string) {
  const { data: wish } = await admin
    .from("wishes")
    .select("id, user_id, status, price_usd_cents, collected_usd_cents, pledged_usd_cents, btc_address, lightning_address, accepts_stripe")
    .eq("id", wishId)
    .maybeSingle<WishRow>();
  if (!wish) return { res: fail("Wish not found.", 404) } as const;
  if (wish.status !== "open") return { res: fail("This wish has already been funded.", 409) } as const;
  if (wish.user_id === buyerId) return { res: fail("You can't fund your own wish.", 403) } as const;
  return { wish } as const;
}

/** What's still uncovered on a wish (price minus verified money minus live card pledges). */
export function remainingCents(w: Pick<WishRow, "price_usd_cents" | "collected_usd_cents" | "pledged_usd_cents">) {
  return Math.max(0, w.price_usd_cents - w.collected_usd_cents - w.pledged_usd_cents);
}

const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;

/**
 * Validates a chip-in amount: at least the minimum ($5) unless it covers everything left, and never
 * more than what's left. Missing amount = cover the rest.
 */
export async function chipInAmount(admin: ReturnType<typeof supabaseAdmin>, wish: WishRow, requested: unknown) {
  const left = remainingCents(wish);
  if (left <= 0) return { res: fail("This wish is already fully pledged.", 409) } as const;
  const { data: limits } = await admin.rpc("wish_limits");
  const min = Math.min((limits as { min_contribution_cents?: number } | null)?.min_contribution_cents ?? 500, left);
  const cents = requested === undefined || requested === null ? left : Math.round(Number(requested));
  if (!Number.isFinite(cents) || cents < min) return { res: fail(`The minimum chip-in is ${dollars(min)}.`) } as const;
  if (cents > left) return { res: fail(`Only ${dollars(left)} is left on this wish.`) } as const;
  return { cents } as const;
}

/** Best-effort client IP (Vercel sets x-forwarded-for). Used only for sock-puppet checks. */
export function clientIp(req: Request): string | null {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "";
  return /^[0-9a-f.:]+$/i.test(ip) ? ip : null;
}
