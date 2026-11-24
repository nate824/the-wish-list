"use client";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { CardFlow } from "./CardFlow";

type Rail = "btc" | "lightning" | "card";

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Something went wrong");
  return json as T;
}

function Qr({ text }: { text: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => { QRCode.toDataURL(text, { margin: 1, width: 220 }).then(setSrc); }, [text]);
  return src ? <img src={src} alt="QR code" width={220} height={220} style={{ borderRadius: 8, background: "#fff" }} /> : null;
}

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn small secondary" onClick={() => { navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); }}>
      {done ? "Copied" : "Copy"}
    </button>
  );
}

export function BuyPanel({ wishId, rails, signedIn, demo, card }: {
  wishId: string; rails: Record<Rail, boolean>; signedIn: boolean; demo: boolean;
  card?: { priceCents: number; feeCents: number; totalCents: number };
}) {
  const available = (["btc", "lightning", "card"] as Rail[]).filter((r) => rails[r]);
  const [rail, setRail] = useState<Rail>(available[0] ?? "btc");

  if (demo) return <div className="notice">Payments are off in demo mode.</div>;
  if (!signedIn) {
    return (
      <div className="panel stack">
        <b>Fund this wish</b>
        <a className="btn" href={`/login?next=/wish/${wishId}`}>Sign in to give</a>
      </div>
    );
  }

  return (
    <div className="panel stack">
      <b>Fund this wish</b>
      <div className="rails">
        {rails.btc && <button type="button" className={`rail ${rail === "btc" ? "on" : ""}`} onClick={() => setRail("btc")}>Bitcoin<small>on-chain</small></button>}
        {rails.lightning && <button type="button" className={`rail ${rail === "lightning" ? "on" : ""}`} onClick={() => setRail("lightning")}>Lightning<small>fast, low fee</small></button>}
        {rails.card ? (
          <button type="button" className={`rail ${rail === "card" ? "on" : ""}`} onClick={() => setRail("card")}>Card / Apple Pay<small>+ card fee</small></button>
        ) : (
          <button type="button" className="rail" disabled title="This wish doesn't take cards">Card / Apple Pay<small>not offered</small></button>
        )}
      </div>
      {rail === "btc" && rails.btc && <BtcFlow wishId={wishId} />}
      {rail === "lightning" && rails.lightning && <LightningFlow wishId={wishId} />}
      {rail === "card" && rails.card && card && <CardFlow wishId={wishId} card={card} />}
    </div>
  );
}

function BtcFlow({ wishId }: { wishId: string }) {
  const [quote, setQuote] = useState<{ purchaseId: string; address: string; sats: number; expiresAt: string } | null>(null);
  const [txid, setTxid] = useState("");
  const [claim, setClaim] = useState<{ message: string; inputAddresses: string[] } | null>(null);
  const [signer, setSigner] = useState("");
  const [sig, setSig] = useState("");
  const [done, setDone] = useState<"verified" | "review" | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function run<T>(fn: () => Promise<T>) {
    setErr(""); setBusy(true);
    try { return await fn(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  if (done === "verified") return <div className="notice ok">Gift verified. Thank you! If you saved a wish, it&apos;s live now. If not, <a href="/wish/new">make one</a>.</div>;
  if (done === "review") return <div className="notice">Got it. A person will check your transaction and unlock your wish once it&apos;s confirmed.</div>;

  if (!quote) {
    return (
      <>
        <button className="btn" disabled={busy} onClick={() => run(async () => setQuote(await post("/api/btc/quote", { wishId })))}>
          {busy ? "Getting price…" : "Show me how much BTC"}
        </button>
        {err && <div className="notice err">{err}</div>}
      </>
    );
  }

  const btc = (quote.sats / 1e8).toFixed(8);
  const uri = `bitcoin:${quote.address}?amount=${btc}`;
  return (
    <div className="stack">
      <div className="row" style={{ alignItems: "flex-start" }}>
        <Qr text={uri} />
        <div className="stack" style={{ flex: 1, minWidth: 200 }}>
          <div><label>Send exactly</label><b>{btc} BTC</b> <span className="hint">({quote.sats.toLocaleString()} sats)</span> <Copy text={btc} /></div>
          <div><label>To</label><span className="mono">{quote.address}</span> <Copy text={quote.address} /></div>
          <div className="hint">Price locked until {new Date(quote.expiresAt).toLocaleTimeString()}.</div>
        </div>
      </div>

      {!claim ? (
        <div className="stack">
          <label htmlFor="txid">After you send it, paste the transaction id</label>
          <input id="txid" type="text" className="mono" value={txid} onChange={(e) => setTxid(e.target.value)} placeholder="e.g. 4a5e1e4b…" />
          <button className="btn" disabled={busy || !txid} onClick={() => run(async () => {
            const c = await post<{ message: string; inputAddresses: string[] }>("/api/btc/claim", { purchaseId: quote.purchaseId, txid });
            setClaim(c); setSigner(c.inputAddresses[0] ?? "");
          })}>{busy ? "Looking it up…" : "Check transaction"}</button>
        </div>
      ) : (
        <div className="stack">
          <div className="notice ok">Found it. One last step proves the gift came from you.</div>
          <div><label>Sign this message in your wallet</label><span className="mono">{claim.message}</span> <Copy text={claim.message} /></div>
          <div>
            <label htmlFor="signer">With this address <span className="hint">(one that sent the coins)</span></label>
            <select id="signer" value={signer} onChange={(e) => setSigner(e.target.value)} style={{ width: "100%", padding: 8 }}>
              {claim.inputAddresses.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div><label htmlFor="sig">Paste the signature</label><textarea id="sig" className="mono" value={sig} onChange={(e) => setSig(e.target.value)} /></div>
          <div className="row">
            <button className="btn" disabled={busy || !sig} onClick={() => run(async () => {
              const r = await post<{ status: "verified" }>("/api/btc/verify", { purchaseId: quote.purchaseId, address: signer, signature: sig });
              setDone(r.status);
            })}>Verify gift</button>
            <button className="btn secondary" disabled={busy} onClick={() => run(async () => {
              const r = await post<{ status: "review" }>("/api/btc/verify", { purchaseId: quote.purchaseId, cantSign: true });
              setDone(r.status);
            })}>I sent from an exchange and can&apos;t sign</button>
          </div>
        </div>
      )}
      {err && <div className="notice err">{err}</div>}
    </div>
  );
}

function LightningFlow({ wishId }: { wishId: string }) {
  const [inv, setInv] = useState<{ purchaseId: string; invoice: string; sats: number; expiresAt: string; mode: "verify" | "wisher" } | null>(null);
  const [status, setStatus] = useState("idle");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!inv || ["verified", "review", "rejected", "expired"].includes(status)) return;
    const t = setInterval(async () => {
      const r = await fetch(`/api/lightning/status?purchaseId=${inv.purchaseId}`).then((r) => r.json()).catch(() => null);
      if (r?.status && r.status !== "pending") setStatus(r.status);
      else if (status === "waiting" && Date.now() > new Date(inv.expiresAt).getTime()) setStatus("expired");
    }, inv.mode === "wisher" ? 10000 : 3000);
    return () => clearInterval(t);
  }, [inv, status]);

  if (status === "verified") return <div className="notice ok">Paid and verified. Thank you! If you saved a wish, it&apos;s live now. If not, <a href="/wish/new">make one</a>.</div>;
  if (status === "review") return <div className="notice">Thanks! We&apos;re double-checking this gift. Your wish unlocks once it clears.</div>;
  if (status === "rejected") return <div className="notice err">The wisher says this payment didn&apos;t arrive. If you did pay, check your wallet&apos;s history.</div>;
  if (status === "awaiting_wisher") return <div className="notice ok">Sent! The wisher&apos;s wallet can&apos;t confirm on its own, so we&apos;ve asked them to confirm. Your wish unlocks when they do. You can close this page.</div>;
  if (status === "expired") return <div className="notice">That invoice expired. <button className="btn small" onClick={() => { setInv(null); setStatus("idle"); }}>Get a new one</button></div>;

  if (!inv) {
    return (
      <>
        <button className="btn" disabled={status === "loading"} onClick={async () => {
          setErr(""); setStatus("loading");
          try { setInv(await post("/api/lightning/invoice", { wishId })); setStatus("waiting"); }
          catch (e) { setErr(e instanceof Error ? e.message : String(e)); setStatus("idle"); }
        }}>{status === "loading" ? "Asking the wisher's wallet…" : "Get Lightning invoice"}</button>
        {err && <div className="notice err">{err}</div>}
      </>
    );
  }

  return (
    <div className="row" style={{ alignItems: "flex-start" }}>
      <Qr text={`lightning:${inv.invoice}`} />
      <div className="stack" style={{ flex: 1, minWidth: 200 }}>
        <div><b>{inv.sats.toLocaleString()} sats</b></div>
        <div className="row"><a className="btn" href={`lightning:${inv.invoice}`}>Open wallet</a><Copy text={inv.invoice} /></div>
        {inv.mode === "verify" ? (
          <div className="hint">Waiting for payment… this updates on its own.</div>
        ) : (
          <>
            <div className="hint">This wisher&apos;s wallet can&apos;t confirm payments automatically. After you pay, tap below and we&apos;ll ask them to confirm.</div>
            <button className="btn secondary" onClick={async () => {
              setErr("");
              try { const r = await post<{ status: string }>("/api/lightning/paid", { purchaseId: inv.purchaseId }); setStatus(r.status); }
              catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
            }}>I&apos;ve paid</button>
            {err && <div className="notice err">{err}</div>}
          </>
        )}
      </div>
    </div>
  );
}

const money = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

