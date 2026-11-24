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
  btc_address: string | null; lightning_address: string | null; accepts_stripe: boolean;
};

export async function loadOpenWish(admin: ReturnType<typeof supabaseAdmin>, wishId: string, buyerId: string) {
  const { data: wish } = await admin
    .from("wishes")
    .select("id, user_id, status, price_usd_cents, btc_address, lightning_address, accepts_stripe")
    .eq("id", wishId)
    .maybeSingle<WishRow>();
  if (!wish) return { res: fail("Wish not found.", 404) } as const;
  if (wish.status !== "open") return { res: fail("This wish has already been funded.", 409) } as const;
  if (wish.user_id === buyerId) return { res: fail("You can't fund your own wish.", 403) } as const;
  return { wish } as const;
}

/** Best-effort client IP (Vercel sets x-forwarded-for). Used only for sock-puppet checks. */
export function clientIp(req: Request): string | null {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "";
  return /^[0-9a-f.:]+$/i.test(ip) ? ip : null;
}
