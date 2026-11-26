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

const money = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

export function BuyPanel({ wishId, rails, signedIn, demo, leftCents, minCents, windowDays, deadline }: {
  wishId: string; rails: Record<Rail, boolean>; signedIn: boolean; demo: boolean;
  leftCents: number; minCents: number; windowDays: number; deadline: string | null;
}) {
  const available = (["btc", "lightning", "card"] as Rail[]).filter((r) => rails[r]);
  const [rail, setRail] = useState<Rail>(available[0] ?? "btc");
  // Chip-in amount: default covers the rest. Locked once a flow has started (flows remount on change).
  const [amountText, setAmountText] = useState((leftCents / 100).toFixed(2));
  const amountCents = Math.round(Number(amountText) * 100) || 0;
  const amountOk = amountCents >= minCents && amountCents <= leftCents;
  const presets = [1000, 2500, 5000, 10000].filter((c) => c >= minCents && c < leftCents);

  if (demo) return <div className="notice">Payments are off in demo mode.</div>;
  if (leftCents <= 0) {
    return <div className="notice ok">Fully pledged! It&apos;s being charged now and will show as funded shortly.</div>;
  }
  if (!signedIn) {
    return (
      <div className="panel stack">
        <b>Chip in on this wish</b>
        <div className="hint">Give any amount from {money(minCents)}. Every gift you give moves your own wishes up the list.</div>
        <a className="btn" href={`/login?next=/wish/${wishId}`}>Sign in to give</a>
      </div>
    );
  }

  return (
    <div className="panel stack">
      <b>Chip in on this wish</b>
      <div className="stack" style={{ gap: 6 }}>
        <label htmlFor="amount">How much? <span className="hint">({money(minCents)} to {money(leftCents)})</span></label>
        <div className="amounts">
          {presets.map((c) => (
            <button key={c} type="button" className={`btn small ${amountCents === c ? "" : "secondary"}`} onClick={() => setAmountText((c / 100).toFixed(2))}>{money(c)}</button>
          ))}
          <button type="button" className={`btn small ${amountCents === leftCents ? "" : "secondary"}`} onClick={() => setAmountText((leftCents / 100).toFixed(2))}>All of it ({money(leftCents)})</button>
        </div>
        <input id="amount" type="number" min={minCents / 100} max={leftCents / 100} step="0.01" value={amountText} onChange={(e) => setAmountText(e.target.value)} />
        {!amountOk && <span className="hint" style={{ color: "var(--accent)" }}>Pick an amount between {money(minCents)} and {money(leftCents)}.</span>}
      </div>
      <div className="rails">
        {rails.btc && <button type="button" className={`rail ${rail === "btc" ? "on" : ""}`} onClick={() => setRail("btc")}>Bitcoin<small>on-chain</small></button>}
        {rails.lightning && <button type="button" className={`rail ${rail === "lightning" ? "on" : ""}`} onClick={() => setRail("lightning")}>Lightning<small>fast, low fee</small></button>}
        {rails.card ? (
          <button type="button" className={`rail ${rail === "card" ? "on" : ""}`} onClick={() => setRail("card")}>Card / Apple Pay<small>charged only if it fills</small></button>
        ) : (
          <button type="button" className="rail" disabled title="This wish doesn't take cards">Card / Apple Pay<small>not offered</small></button>
        )}
      </div>
      {rail !== "card" && amountCents < leftCents && (
        <div className="hint">Bitcoin and Lightning go straight to the wisher now, even if the rest isn&apos;t raised. Cards are only charged once the whole wish is covered.</div>
      )}
      {amountOk && rail === "btc" && rails.btc && <BtcFlow key={amountCents} wishId={wishId} amountCents={amountCents} />}
      {amountOk && rail === "lightning" && rails.lightning && <LightningFlow key={amountCents} wishId={wishId} amountCents={amountCents} />}
      {amountOk && rail === "card" && rails.card && (
        <CardFlow key={amountCents} wishId={wishId} amountCents={amountCents} completes={amountCents === leftCents} windowDays={windowDays} deadline={deadline} />
      )}
    </div>
  );
}

function BtcFlow({ wishId, amountCents }: { wishId: string; amountCents: number }) {
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

  if (done === "verified") return <div className="notice ok">Gift verified. Thank you! Your giving score just went up, so your wishes rank higher. No wish yet? <a href="/wish/new">Make one</a>.</div>;
  if (done === "review") return <div className="notice">Got it. A person will check your transaction. It counts toward the wish (and your score) once it&apos;s confirmed.</div>;

  if (!quote) {
    return (
      <>
        <button className="btn" disabled={busy} onClick={() => run(async () => setQuote(await post("/api/btc/quote", { wishId, amountCents })))}>
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

function LightningFlow({ wishId, amountCents }: { wishId: string; amountCents: number }) {
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

  if (status === "verified") return <div className="notice ok">Paid and verified. Thank you! Your giving score just went up, so your wishes rank higher. No wish yet? <a href="/wish/new">Make one</a>.</div>;
  if (status === "review") return <div className="notice">Thanks! We&apos;re double-checking this gift. It counts toward your score once it clears.</div>;
  if (status === "rejected") return <div className="notice err">The wisher says this payment didn&apos;t arrive. If you did pay, check your wallet&apos;s history.</div>;
  if (status === "awaiting_wisher") return <div className="notice ok">Sent! The wisher&apos;s wallet can&apos;t confirm on its own, so we&apos;ve asked them to confirm. It counts toward your score when they do. You can close this page.</div>;
  if (status === "expired") return <div className="notice">That invoice expired. <button className="btn small" onClick={() => { setInv(null); setStatus("idle"); }}>Get a new one</button></div>;

  if (!inv) {
    return (
      <>
        <button className="btn" disabled={status === "loading"} onClick={async () => {
          setErr(""); setStatus("loading");
          try { setInv(await post("/api/lightning/invoice", { wishId, amountCents })); setStatus("waiting"); }
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

