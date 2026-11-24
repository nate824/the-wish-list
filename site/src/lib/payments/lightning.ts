// Lightning rail via LNURL-pay (LUD-06/16) + LUD-21 verify. See lnurl-checklist.md.
// No node, no keys: the wisher brings a Lightning address; we request an invoice and poll `verify`.
// All calls are server-side. Tested 2026-11-23: Coinos supports LUD-21 verify, Strike doesn't.
// No-verify addresses fall back to wisher confirmation (see migration 0005).
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { decode } from "light-bolt11-decoder";

const TIMEOUT_MS = 6000;
const MAX_BYTES = 64 * 1024;

type PayRequest = {
  tag: "payRequest";
  callback: string;
  minSendable: number; // msats
  maxSendable: number; // msats
  metadata: string;
  commentAllowed?: number;
};

/** verify is null when the provider lacks LUD-21 (e.g. Strike): the wisher confirms receipt instead. */
export type Invoice = { pr: string; verify: string | null; paymentHash: string; expiresAt: number };

export function parseLightningAddress(addr: string): { user: string; domain: string } | null {
  const m = addr.trim().toLowerCase().match(/^([a-z0-9._+-]+)@([a-z0-9.-]+\.[a-z]{2,})$/);
  return m ? { user: m[1], domain: m[2] } : null;
}

// --- SSRF guard (checklist #8): https only, public IPs only, short timeout, size cap -------------
function isPrivateIp(ip: string): boolean {
  if (ip.includes(":")) {
    const v = ip.toLowerCase();
    return v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v === "::" || v.startsWith("::ffff:");
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

async function safeGetJson<T>(url: string): Promise<T> {
  const u = new URL(url);
  if (u.protocol !== "https:") throw new Error("Lightning endpoint must use https");
  const addrs = await lookup(u.hostname, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error("Lightning endpoint is not a public host");
  // NOTE: DNS can change between lookup and fetch (rebinding). Acceptable for v1; revisit with a pinned agent.
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error", cache: "no-store" });
  if (!res.ok) throw new Error(`Lightning endpoint returned ${res.status}`);
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new Error("Lightning endpoint response too large");
  return JSON.parse(text) as T;
}

async function resolve(addr: string): Promise<PayRequest> {
  const parsed = parseLightningAddress(addr);
  if (!parsed) throw new Error("That isn't a Lightning address (name@domain).");
  const pr = await safeGetJson<PayRequest & { status?: string; reason?: string }>(
    `https://${parsed.domain}/.well-known/lnurlp/${encodeURIComponent(parsed.user)}`,
  );
  if (pr.status === "ERROR") throw new Error(pr.reason ?? "Lightning provider returned an error");
  if (pr.tag !== "payRequest") throw new Error("Lightning address did not return a pay request");
  return pr;
}

/** Checklist #3: amount and description hash must match what we asked for. */
function checkInvoice(pr: string, msats: number, metadata: string): { paymentHash: string; expiresAt: number } {
  const inv = decode(pr);
  const get = (name: string) => inv.sections.find((s) => s.name === name) as { value?: unknown } | undefined;
  const amount = Number(get("amount")?.value);
  if (amount !== msats) throw new Error("Invoice amount doesn't match the quote");
  const descHash = get("description_hash")?.value as string | undefined;
  const expected = createHash("sha256").update(metadata, "utf8").digest("hex");
  if (descHash && descHash !== expected) throw new Error("Invoice description hash doesn't match (LUD-06)");
  const paymentHash = String(get("payment_hash")?.value ?? "");
  const ts = Number(get("timestamp")?.value ?? Math.floor(Date.now() / 1000));
  return { paymentHash, expiresAt: (ts + (inv.expiry ?? 3600)) * 1000 };
}

export async function requestInvoice(addr: string, msats: number, comment?: string): Promise<Invoice> {
  const pr = await resolve(addr);
  if (msats < pr.minSendable || msats > pr.maxSendable) {
    throw new Error(`Amount outside this wallet's limits (${pr.minSendable / 1000}-${pr.maxSendable / 1000} sats)`);
  }
  const cb = new URL(pr.callback);
  cb.searchParams.set("amount", String(msats));
  if (comment && pr.commentAllowed && comment.length <= pr.commentAllowed) cb.searchParams.set("comment", comment);
  const res = await safeGetJson<{ pr?: string; verify?: string; status?: string; reason?: string }>(cb.toString());
  if (res.status === "ERROR" || !res.pr) throw new Error(res.reason ?? "Wallet didn't return an invoice");
  const { paymentHash, expiresAt } = checkInvoice(res.pr, msats, pr.metadata);
  return { pr: res.pr, verify: res.verify || null, paymentHash, expiresAt };
}

/** Checklist #1: on save, request a small test invoice. Addresses without LUD-21 `verify` are
 *  accepted; their gifts are confirmed by the wisher instead (migration 0005). */
export async function validateLightningAddress(addr: string): Promise<{ ok: true; verify: boolean } | { ok: false; reason: string }> {
  try {
    const pr = await resolve(addr);
    const inv = await requestInvoice(addr, Math.max(pr.minSendable, 1000));
    return { ok: true, verify: !!inv.verify };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** LUD-21 verify. When the provider returns a preimage, require sha256(preimage) == payment hash,
 *  so a lying endpoint can't fake `settled: true` without the real proof of payment. */
export async function checkSettled(verifyUrl: string, paymentHash?: string | null): Promise<boolean> {
  const res = await safeGetJson<{ settled?: boolean; status?: string; preimage?: string | null }>(verifyUrl);
  if (res.settled !== true) return false;
  if (paymentHash && res.preimage) {
    if (!/^[0-9a-f]{64}$/i.test(res.preimage)) return false;
    const h = createHash("sha256").update(Buffer.from(res.preimage, "hex")).digest("hex");
    return h === paymentHash.toLowerCase();
  }
  return true;
}
