import Link from "next/link";
import { getLimits, getWishesGranted } from "@/lib/data";
import { usd } from "@/lib/payments/fees";

export const metadata = { title: "Roadmap" };
export const revalidate = 300;

type Milestone = { at: number | null; goal: string; unlock: string; body: React.ReactNode };

const n = (x: number) => x.toLocaleString("en-US");

export default async function RoadmapPage() {
  const [granted, limits] = await Promise.all([getWishesGranted(), getLimits()]);
  const cap = usd(limits.max_price_cents);

  const milestones: Milestone[] = [
    {
      at: 1000, goal: "1,000 wishes granted", unlock: "Raise the price cap",
      body: <>Wishes are capped at {cap} for now while we prove the idea works. A thousand granted wishes shows people trust it, so the cap goes up.</>,
    },
    {
      at: 5000, goal: "5,000 wishes granted", unlock: "Remove the price cap",
      body: <>Big wishes, like a laptop for school or a flight home, can pool gifts from as many givers as it takes.</>,
    },
    {
      at: 10000, goal: "10,000 wishes granted", unlock: "Become a registered charity",
      body: <>We&apos;ll work toward registering a nonprofit, such as a US 501(c)(3), and explore tax-deductible ways to give. Gifts to a specific person usually aren&apos;t deductible even through a charity, so we&apos;ll be clear about exactly what is before anyone counts on it.</>,
    },
    {
      at: null, goal: "After that", unlock: "Sweepstakes-style pooled giving",
      body: <>A way for many people to pool small gifts and have them granted to wishers picked at random, run as a free-to-enter sweepstakes where the law allows it.</>,
    },
    {
      at: 1_000_000, goal: "1,000,000 wishes granted", unlock: "A million wishes",
      body: <>A million people around the world who asked for something and got it from a stranger.</>,
    },
  ];

  // The first milestone with a count we haven't reached is the one we're working on.
  const nowIdx = granted === null ? -1 : milestones.findIndex((m) => m.at !== null && granted < m.at);
  const prevAt = nowIdx > 0 ? milestones.slice(0, nowIdx).reduce((a, m) => m.at ?? a, 0) : 0;

  return (
    <div style={{ maxWidth: 680, margin: "40px auto" }} className="stack">
      <h1 style={{ margin: 0 }}>Roadmap</h1>
      <p>
        Where we want to take The Wish List. Each step unlocks when enough wishes have been granted. These are goals,
        not promises: dates and details depend on growth and on what the law allows where you live.
      </p>
      {granted !== null && (
        <div className="counter" style={{ alignSelf: "flex-start", margin: 0 }}><strong>{n(granted)}</strong> {granted === 1 ? "wish" : "wishes"} granted so far</div>
      )}

      <ol className="roadmap">
        {milestones.map((m, i) => {
          const done = granted !== null && m.at !== null && granted >= m.at;
          const now = i === nowIdx;
          const pct = now && m.at ? Math.min(100, Math.max(0, ((granted! - prevAt) / (m.at - prevAt)) * 100)) : 0;
          return (
            <li key={m.unlock} className={done ? "done" : now ? "now" : ""}>
              <span className="dot" aria-hidden>{done ? "✓" : i + 1}</span>
              <div className="goal">{m.goal}</div>
              <div className="unlock">{m.unlock}</div>
              <p>{m.body}</p>
              {now && m.at && (
                <>
                  <div className="fundbar" role="progressbar" aria-valuemin={0} aria-valuemax={m.at} aria-valuenow={granted!}>
                    <span className="got" style={{ width: `${Math.max(pct, 1.5)}%` }} />
                  </div>
                  <div className="hint">{n(granted!)} of {n(m.at)}</div>
                </>
              )}
            </li>
          );
        })}
      </ol>

      <p className="hint">
        The fastest way to move us along: <Link href="/feed">grant a wish</Link>. Questions about costs? See <Link href="/fees">Fees</Link>.
      </p>
    </div>
  );
}
