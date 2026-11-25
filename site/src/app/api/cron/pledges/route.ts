import { NextResponse } from "next/server";
import { fail } from "@/lib/api";
import { DEMO_MODE } from "@/lib/config";
import { sweepPledges } from "@/lib/payments/pledges";
import { supabaseAdmin } from "@/lib/supabase/server";

// Pledge housekeeping: expire pledges past their funding window (cards never charged, then detached),
// and charge any wish that's covered but not charged yet. Wish pages also do this lazily, so this is
// a safety net. Hit it hourly from any scheduler with:  Authorization: Bearer <CRON_SECRET>
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return fail("CRON_SECRET not set.", 501);
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return fail("Not allowed.", 401);
  if (DEMO_MODE) return fail("Needs Supabase.", 503);
  return NextResponse.json(await sweepPledges(supabaseAdmin()));
}
