import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { publicOrigin } from "@/lib/publicOrigin";

export async function POST(req: NextRequest) {
  const sb = await supabaseServer();
  await sb.auth.signOut();
  return NextResponse.redirect(new URL("/", publicOrigin(req)), { status: 303 });
}
