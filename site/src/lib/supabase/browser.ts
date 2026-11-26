"use client";
import { createBrowserClient } from "@supabase/ssr";
import { supabaseAnonKey, supabaseUrl } from "../config";

/** Browser client acting as the signed-in user (cookie session). Used for direct-to-Storage uploads. */
export function supabaseBrowser() {
  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
