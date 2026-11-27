import type { NextRequest } from "next/server";
import { SITE_URL } from "@/lib/config";

// Behind Replit's proxy, req.url is http://0.0.0.0:3000/..., so redirects built from it
// send people to an address that doesn't work. Use the host the visitor actually hit.
export function publicOrigin(req: NextRequest): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host && !/^(0\.0\.0\.0|127\.0\.0\.1)(:|$)/.test(host)) {
    const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim()
      ?? (host.startsWith("localhost") ? "http" : "https");
    return `${proto}://${host.split(",")[0].trim()}`;
  }
  return SITE_URL;
}
