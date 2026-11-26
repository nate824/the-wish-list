import type { Tier } from "./config";

export type PublicWish = {
  id: string;
  title: string;
  description: string | null;
  price_usd_cents: number;
  tier: Tier;
  status: "open" | "funded";
  created_at: string;
  funded_at: string | null;
  is_anonymous: boolean;
  display_name: string | null;
  bio: string | null;
  photo_url: string | null;
  btc_address: string | null;
  lightning_address: string | null;
  accepts_stripe: boolean;
  /** Verified money so far (crypto + charged cards). */
  collected_usd_cents: number;
  /** Saved cards waiting to be charged once the wish is covered. */
  pledged_usd_cents: number;
  /** When live pledges expire if the wish isn't covered. Null = no pledges right now. */
  funding_deadline: string | null;
  /** The wisher's giving score. The feed ranks by this. */
  owner_score: number;
};
