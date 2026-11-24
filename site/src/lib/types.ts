import type { Tier } from "./config";

export type PublicWish = {
  id: string;
  title: string;
  description: string | null;
  price_usd_cents: number;
  tier: Tier;
  status: "draft" | "open" | "funded";
  created_at: string;
  funded_at: string | null;
  is_anonymous: boolean;
  display_name: string | null;
  bio: string | null;
  photo_url: string | null;
  btc_address: string | null;
  lightning_address: string | null;
  accepts_stripe: boolean;
};
