import type { Metadata } from "next";
import Link from "next/link";
import { Fraunces } from "next/font/google";
import "./globals.css";
import { DEMO_MODE, SITE_NAME } from "@/lib/config";
import { getMe } from "@/lib/data";

const display = Fraunces({ subsets: ["latin"], weight: ["600", "700"], style: ["normal", "italic"], variable: "--font-display", display: "swap" });

export const metadata: Metadata = {
  title: `${SITE_NAME} — a worldwide Secret Santa`,
  description: "A worldwide Secret Santa. Make a wish, grant someone else's, get yours granted.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  return (
    <html lang="en" className={display.variable}>
      <body>
        {DEMO_MODE && (
          <div className="banner">Demo mode: sample wishes, payments and sign-in are off until Supabase is connected.</div>
        )}
        <header className="site">
          <div className="wrap">
            <Link href="/" className="brand">the <span>wish</span> list</Link>
            <nav className="main">
              <Link href="/feed">Browse<span className="wide"> wishes</span></Link>
              <Link href="/wish/new">Post<span className="wide"> a wish</span></Link>
              {me && <Link href="/gifts">Gifts</Link>}
              {me && <Link href="/payouts">Payouts</Link>}
              {me?.isAdmin && <Link href="/admin">Review</Link>}
              {me ? (
                <form action="/auth/signout" method="post"><button className="btn small secondary">Sign out</button></form>
              ) : (
                <Link href="/login" className="btn small">Sign in</Link>
              )}
            </nav>
          </div>
        </header>
        <main className="wrap">{children}</main>
        <footer className="site">
          <div className="wrap">
            Gifts are voluntary. Bitcoin and Lightning gifts go straight from giver to wisher. Card gifts are processed by Stripe and held there until the wisher sets up payouts. No wish is guaranteed to be funded.
            Payments are final. You are responsible for any taxes on gifts you receive. <a href="/fees">Fees</a> · <a href="/roadmap">Roadmap</a>
          </div>
        </footer>
      </body>
    </html>
  );
}
