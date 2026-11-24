"use client";
import { useState } from "react";

export function ConfirmButtons({ purchaseId }: { purchaseId: string }) {
  const [state, setState] = useState<"idle" | "busy" | string>("idle");
  async function send(received: boolean) {
    setState("busy");
    const r = await fetch("/api/lightning/confirm", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ purchaseId, received }),
    }).then((r) => r.json()).catch(() => ({ error: "Network error" }));
    setState(r.error ? `err:${r.error}` : r.status);
  }
  if (state === "verified") return <span className="notice ok">Confirmed. Thank you!</span>;
  if (state === "review") return <span className="notice">Thanks. We&apos;re double-checking this one.</span>;
  if (state === "rejected") return <span className="notice">Marked as not received.</span>;
  return (
    <div className="row">
      <button className="btn small" disabled={state === "busy"} onClick={() => send(true)}>I got it</button>
      <button className="btn small secondary" disabled={state === "busy"} onClick={() => send(false)}>Didn&apos;t arrive</button>
      {state.startsWith("err:") && <span className="notice err">{state.slice(4)}</span>}
    </div>
  );
}
