// On-chain BTC rail: peer to peer. The site never holds funds; it only checks the chain.
// Flow (plan 5.2): quote -> buyer pays wisher's address -> buyer pastes txid -> site checks tx
// -> buyer signs `wishlist:claim:<txid>:<nonce>` with a funding input address (BIP-322) -> verified.
// Exchange senders who can't sign go to the manual review queue.
import { address as btcAddress, networks } from "bitcoinjs-lib";
import { Verifier } from "bip322-js";
import { BTC_TOLERANCE } from "../config";

const MEMPOOL = "https://mempool.space/api";

export function isValidBtcAddress(addr: string): boolean {
  try {
    btcAddress.toOutputScript(addr.trim(), networks.bitcoin);
    return true;
  } catch {
    return false;
  }
}

export function claimMessage(txid: string, nonce: string) {
  return `wishlist:claim:${txid}:${nonce}`;
}

type MempoolTx = {
  txid: string;
  vin: { prevout: { scriptpubkey_address?: string; value: number } | null }[];
  vout: { scriptpubkey_address?: string; value: number }[];
  status: { confirmed: boolean; block_height?: number };
};

export type TxCheck =
  | { ok: true; paidSats: number; confirmed: boolean; inputAddresses: string[] }
  | { ok: false; reason: string };

/** Confirm the tx pays at least (quotedSats * (1 - tolerance)) to the wish address. */
export async function checkTx(txid: string, wishAddress: string, quotedSats: number): Promise<TxCheck> {
  if (!/^[0-9a-f]{64}$/i.test(txid)) return { ok: false, reason: "That doesn't look like a transaction id." };
  const res = await fetch(`${MEMPOOL}/tx/${txid}`, { cache: "no-store" });
  if (res.status === 404 || res.status === 400) return { ok: false, reason: "Transaction not found yet. Give it a minute and retry." };
  if (!res.ok) return { ok: false, reason: `Chain lookup failed (${res.status}).` };
  const tx = (await res.json()) as MempoolTx;

  const paidSats = tx.vout
    .filter((o) => o.scriptpubkey_address === wishAddress)
    .reduce((s, o) => s + o.value, 0);
  const minSats = Math.floor(quotedSats * (1 - BTC_TOLERANCE));
  if (paidSats < minSats) {
    return { ok: false, reason: `This transaction sends ${paidSats} sats to the wish address; at least ${minSats} needed.` };
  }
  const inputAddresses = [
    ...new Set(tx.vin.map((i) => i.prevout?.scriptpubkey_address).filter((a): a is string => !!a)),
  ];
  return { ok: true, paidSats, confirmed: tx.status.confirmed, inputAddresses };
}

/** BIP-322 covers segwit/taproot; bip322-js falls back to legacy BIP-137 signatures for P2PKH. */
export function verifyClaimSignature(signerAddress: string, message: string, signature: string): boolean {
  try {
    return Verifier.verifySignature(signerAddress, message, signature.trim());
  } catch {
    return false;
  }
}
