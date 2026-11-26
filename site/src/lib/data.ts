import { DEMO_MODE, adminEmails, type Tier } from "./config";
import { DEMO_FOUNDING_LEFT, DEMO_WISHES } from "./demo";
import { supabaseServer } from "./supabase/server";
import type { PublicWish } from "./types";
import { bioVideoUrl } from "./bioVideo";

export const PER_TIER_PER_PAGE = 4;

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Feed: oldest unfunded first, built in tier slices so every page mixes prices.
 * "All" = take the N oldest open wishes from each tier for this page, then shuffle.
 * A single tier = oldest first, no shuffle.
 */
export async function getFeed(tier: Tier | "all", page: number) {
  const n = PER_TIER_PER_PAGE;
  const tiers: Tier[] = tier === "all" ? ["small", "mid", "big"] : [tier];
  const pageSize = tier === "all" ? n : n * 3;

  const slices = await Promise.all(
    tiers.map(async (t) => {
      if (DEMO_MODE) {
        return DEMO_WISHES.filter((w) => w.tier === t && w.status === "open")
          .sort((a, b) => a.created_at.localeCompare(b.created_at))
          .slice(page * pageSize, page * pageSize + pageSize + 1);
      }
      const sb = await supabaseServer();
      const { data, error } = await sb
        .from("public_wishes")
        .select("*")
        .eq("status", "open")
        .eq("tier", t)
        .order("created_at", { ascending: true })
        .range(page * pageSize, page * pageSize + pageSize); // one extra to detect "more"
      if (error) throw error;
      return (data ?? []) as PublicWish[];
    }),
  );

  const hasMore = slices.some((s) => s.length > pageSize);
  const items = slices.flatMap((s) => s.slice(0, pageSize));
  return { wishes: tier === "all" ? shuffle(items) : items, hasMore };
}

export async function getWish(id: string): Promise<PublicWish | null> {
  if (DEMO_MODE) return DEMO_WISHES.find((w) => w.id === id) ?? null;
  const sb = await supabaseServer();
  const { data } = await sb.from("public_wishes").select("*").eq("id", id).maybeSingle();
  if (data) return data as PublicWish;
  // Not public: maybe it's the signed-in user's own draft (RLS lets owners read their rows).
  const { data: own } = await sb.from("wishes").select(OWN_WISH_COLUMNS).eq("id", id).eq("status", "draft").maybeSingle();
  return own ? ownToPublic(own as OwnWishRow) : null;
}

/** Public URL of the wisher's bio video for a public, non-anonymous wish, if they have one that isn't hidden. */
export async function getWishBioVideo(wishId: string): Promise<string | null> {
  if (DEMO_MODE) return null;
  const sb = await supabaseServer();
  const { data } = await sb.from("wish_bio_videos").select("bio_video_path").eq("wish_id", wishId).maybeSingle();
  return data?.bio_video_path ? bioVideoUrl(data.bio_video_path) : null;
}

const OWN_WISH_COLUMNS =
  "id, title, description, price_usd_cents, tier, status, created_at, funded_at, is_anonymous, btc_address, lightning_address, accepts_stripe";
type OwnWishRow = Omit<PublicWish, "display_name" | "bio" | "photo_url">;
function ownToPublic(w: OwnWishRow): PublicWish {
  return { ...w, display_name: null, bio: null, photo_url: null };
}

/** The signed-in user's unpublished wish, if any (goes live when their gift is verified). */
export async function getMyDraft(): Promise<PublicWish | null> {
  if (DEMO_MODE) return null;
  const sb = await supabaseServer();
  const { data } = await sb.from("wishes").select(OWN_WISH_COLUMNS).eq("status", "draft")
    .order("created_at").limit(1).maybeSingle();
  return data ? ownToPublic(data as OwnWishRow) : null;
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
};

export async function getMe(): Promise<Me | null> {
  if (DEMO_MODE) return null;
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const [{ data: profile }, { data: canPost }] = await Promise.all([
    sb.from("profiles").select("is_admin, is_founding_member").eq("user_id", user.id).maybeSingle(),
    sb.rpc("can_post_wish"),
  ]);
  const email = (user.email ?? "").toLowerCase();
  return {
    id: user.id,
    email,
    isAdmin: !!profile?.is_admin || adminEmails().includes(email),
    isFounding: !!profile?.is_founding_member,
    canPost: !!canPost,
  };
}
