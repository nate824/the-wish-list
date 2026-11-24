export const SITE_NAME = "The Wish List"; // GUESS: placeholder until the name/domain is picked

export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** No Supabase keys yet -> the site runs on built-in sample wishes, writes are disabled. */
export const DEMO_MODE = !supabaseUrl || !supabaseAnonKey;

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const FOUNDING_CAP = 100;

/** BTC quote tolerance and lock (plan 5.2: +/-3%, 15 minutes). */
export const BTC_TOLERANCE = 0.03;
export const QUOTE_LOCK_MINUTES = 15;

export type Tier = "small" | "mid" | "big";
export const TIERS: { key: Tier; label: string; range: string }[] = [
  { key: "small", label: "Small", range: "under $25" },
  { key: "mid", label: "Mid", range: "$25 to $100" },
  { key: "big", label: "Big", range: "over $100" },
];

export function tierFor(cents: number): Tier {
  if (cents < 2500) return "small";
  if (cents <= 10000) return "mid";
  return "big";
}

export function usd(cents: number) {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  });
}

export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}
