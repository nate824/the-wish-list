"use client";
import { createBrowserClient } from "@supabase/ssr";
import { useState } from "react";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export default function Login() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [err, setErr] = useState("");

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!url || !key) { setErr("Sign-in is off in demo mode."); setState("error"); return; }
    setState("sending");
    // TODO: Cloudflare Turnstile token check before sending (plan section 6)
    const sb = createBrowserClient(url, key);
    const next = new URLSearchParams(window.location.search).get("next") ?? "/feed";
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    if (error) { setErr(error.message); setState("error"); } else setState("sent");
  }

  return (
    <div style={{ maxWidth: 420, margin: "56px auto" }} className="panel stack">
      <h2 className="section" style={{ margin: 0 }}>Sign in</h2>
      <p className="hint" style={{ margin: 0 }}>We&apos;ll email you a link. No password.</p>
      {state === "sent" ? (
        <div className="notice ok">Check your inbox for the sign-in link.</div>
      ) : (
        <form onSubmit={send} className="stack">
          <input type="email" required placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="btn" disabled={state === "sending"}>{state === "sending" ? "Sending…" : "Email me a link"}</button>
          {state === "error" && <div className="notice err">{err}</div>}
        </form>
      )}
    </div>
  );
}
