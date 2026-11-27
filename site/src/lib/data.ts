import { DEMO_MODE, adminEmails, type Tier } from "./config";
import { DEMO_FOUNDING_LEFT, DEMO_WISHES } from "./demo";
import { supabaseServer } from "./supabase/server";
import type { PublicWish } from "./types";
import { bioVideoUrl } from "./bioVideo";

export const PER_TIER_PER_PAGE = 4;

/** Feed rank: wishers who give more rank higher; ties go to whoever has waited longest. */
function byRank(a: PublicWish, b: PublicWish) {
  return (b.owner_score ?? 0) - (a.owner_score ?? 0) || a.created_at.localeCompare(b.created_at);
}

/** Expire pledges whose funding window ran out (cheap, idempotent). Keeps the shown totals honest. */
async function expireStalePledges() {
  const sb = await supabaseServer();
  await sb.rpc("expire_stale_pledges");
}

/**
 * Feed: ranked by the wisher's giving score, then oldest first, built in tier slices so every
 * page mixes prices. "All" = the top N of each tier for this page, merged in rank order.
 */
export async function getFeed(tier: Tier | "all", page: number) {
  const n = PER_TIER_PER_PAGE;
  const tiers: Tier[] = tier === "all" ? ["small", "mid", "big"] : [tier];
  const pageSize = tier === "all" ? n : n * 3;
  if (!DEMO_MODE) await expireStalePledges().catch(() => {});

  const slices = await Promise.all(
    tiers.map(async (t) => {
      if (DEMO_MODE) {
        return DEMO_WISHES.filter((w) => w.tier === t && w.status === "open")
          .sort(byRank)
          .slice(page * pageSize, page * pageSize + pageSize + 1);
      }
      const sb = await supabaseServer();
      const { data, error } = await sb
        .from("public_wishes")
        .select("*")
        .eq("status", "open")
        .eq("tier", t)
        .order("owner_score", { ascending: false })
        .order("created_at", { ascending: true })
        .range(page * pageSize, page * pageSize + pageSize); // one extra to detect "more"
      if (error) throw error;
      return (data ?? []) as PublicWish[];
    }),
  );

  const hasMore = slices.some((s) => s.length > pageSize);
  const items = slices.flatMap((s) => s.slice(0, pageSize));
  return { wishes: tier === "all" ? items.sort(byRank) : items, hasMore };
}

export async function getWish(id: string): Promise<PublicWish | null> {
  if (DEMO_MODE) return DEMO_WISHES.find((w) => w.id === id) ?? null;
  await expireStalePledges().catch(() => {});
  const sb = await supabaseServer();
  const { data } = await sb.from("public_wishes").select("*").eq("id", id).maybeSingle();
  return (data as PublicWish) ?? null;
}

export type WishLimits = { min_price_cents: number; max_price_cents: number; min_contribution_cents: number; pledge_window_days: number };
const DEFAULT_LIMITS: WishLimits = { min_price_cents: 500, max_price_cents: 50000, min_contribution_cents: 500, pledge_window_days: 14 };

/** Public URL of the wisher's bio video for a public, non-anonymous wish, if they have one that isn't hidden. */
export async function getWishBioVideo(wishId: string): Promise<string | null> {
  if (DEMO_MODE) return null;
  const sb = await supabaseServer();
  const { data } = await sb.from("wish_bio_videos").select("bio_video_path").eq("wish_id", wishId).maybeSingle();
  return data?.bio_video_path ? bioVideoUrl(data.bio_video_path) : null;
}


/** Price cap, minimum chip-in and pledge window (app_settings, tunable without a redeploy). */
export async function getLimits(): Promise<WishLimits> {
  if (DEMO_MODE) return DEFAULT_LIMITS;
  const sb = await supabaseServer();
  const { data } = await sb.rpc("wish_limits");
  return { ...DEFAULT_LIMITS, ...((data as Partial<WishLimits>) ?? {}) };
}

/** The signed-in giver's chip-ins on one wish whose card was declined when the wish filled. */
export async function getMyFailedPledges(wishId: string, userId: string) {
  if (DEMO_MODE) return [];
  const sb = await supabaseServer();
  const { data } = await sb.from("purchases").select("id, amount_usd_cents")
    .eq("wish_id", wishId).eq("buyer_id", userId).not("charge_failed_at", "is", null).eq("status", "rejected");
  return (data ?? []) as { id: string; amount_usd_cents: number }[];
}

export async function getFoundingSpotsLeft(): Promise<number> {
  if (DEMO_MODE) return DEMO_FOUNDING_LEFT;
  const sb = await supabaseServer();
  const { data } = await sb.rpc("founding_spots_left");
  return typeof data === "number" ? data : 0;
}

export type Me = {
  id: string;
  email: string;
  isAdmin: boolean;
  isFounding: boolean;
  canPost: boolean;
  givingScore: number;
  wishesHelped: number;
};

export async function getMe(): Promise<Me | null> {
  if (DEMO_MODE) return null;
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const [{ data: profile }, { data: canPost }] = await Promise.all([
    sb.from("profiles").select("is_admin, is_founding_member, giving_score, wishes_helped").eq("user_id", user.id).maybeSingle(),
    sb.rpc("can_post_wish"),
  ]);
  const email = (user.email ?? "").toLowerCase();
  return {
    id: user.id,
    email,
    isAdmin: !!profile?.is_admin || adminEmails().includes(email),
    isFounding: !!profile?.is_founding_member,
    canPost: !!canPost,
    givingScore: profile?.giving_score ?? 0,
    wishesHelped: profile?.wishes_helped ?? 0,
  };
}

/** Wishes granted so far (fully funded), for the public roadmap. Null if it can't be read. */
export async function getWishesGranted(): Promise<number | null> {
  if (DEMO_MODE) return DEMO_WISHES.filter((w) => w.status === "funded").length;
  try {
    const sb = await supabaseServer();
    const { count, error } = await sb.from("public_wishes").select("id", { count: "exact", head: true }).eq("status", "funded");
    return error ? null : count ?? 0;
  } catch {
    return null;
  }
}
