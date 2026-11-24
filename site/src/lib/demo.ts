import type { PublicWish } from "./types";
import { tierFor } from "./config";

// Sample wishes shown while no Supabase project is connected. Not real people.
const raw: [string, number, string | null, string | null, number][] = [
  ["Warm winter gloves", 1800, null, null, 9],
  ["A paperback copy of a favorite novel to reread", 1500, "Maya", "Night-shift nurse, reads on breaks.", 8],
  ["Art supplies for my daughter", 4000, null, null, 8],
  ["New running shoes", 9500, "Jordan", "Training for my first half marathon.", 7],
  ["Groceries for a week", 12000, null, null, 7],
  ["Bus pass for January", 6400, "Sam", "Starting a new job after the holidays.", 6],
  ["A board game for family night", 3500, null, null, 6],
  ["Used laptop for school", 35000, "Priya", "First-gen college student, CS major.", 5],
  ["Coffee beans from a local roaster", 2200, null, null, 5],
  ["Car repair: new brake pads", 28000, null, null, 4],
  ["Guitar strings and a tuner", 3000, "Leo", "Teaching myself guitar this winter.", 4],
  ["Kids' winter coat", 5500, null, null, 3],
  ["Phone screen repair", 14000, null, null, 3],
  ["Cozy socks", 1200, null, null, 2],
  ["Dog food for a month", 6000, "Ana", "Two rescues, one very large.", 2],
  ["Dental cleaning", 18000, null, null, 1],
];

export const DEMO_WISHES: PublicWish[] = raw.map(([title, cents, name, bio, daysAgo], i) => ({
  id: `demo-${i + 1}`,
  title,
  description: null,
  price_usd_cents: cents,
  tier: tierFor(cents),
  status: "open",
  created_at: new Date(Date.now() - daysAgo * 86400_000 - i * 3600_000).toISOString(),
  funded_at: null,
  is_anonymous: !name,
  display_name: name,
  bio,
  photo_url: null,
  btc_address: "bc1q-demo-address",
  lightning_address: i % 2 === 0 ? "demo@getalby.com" : null,
  accepts_stripe: true,
}));

export const DEMO_FOUNDING_LEFT = 73;
