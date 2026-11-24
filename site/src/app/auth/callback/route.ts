import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

// Magic-link landing. First verified sign-in also tries to claim a Founding 100 spot (atomic in DB).
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const next = req.nextUrl.searchParams.get("next") ?? "/feed";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/feed";
  if (code) {
    const sb = await supabaseServer();
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (!error) {
      await sb.rpc("claim_founding_spot"); // idempotent
      return NextResponse.redirect(new URL(safeNext, req.url));
    }
  }
  return NextResponse.redirect(new URL("/login?error=link", req.url));
}
