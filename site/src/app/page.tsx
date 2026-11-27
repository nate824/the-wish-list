import Link from "next/link";
import { WishCard } from "@/components/WishCard";
import { getFeed } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { wishes } = await getFeed("all", 0);
  return (
    <>
      <section className="hero snowy">
        <span className="eyebrow">Season of giving</span>
        <h1>The <em>Wish</em> List</h1>
        <p className="lead">A worldwide Secret Santa.</p>
        <div className="row">
          <Link href="/wish/new" className="btn">Make a wish</Link>
          <Link href="/feed" className="btn secondary">Grant a wish</Link>
        </div>
        <svg className="ornaments" viewBox="0 0 230 250" aria-hidden="true">
          <defs>
            <radialGradient id="shine" cx="35%" cy="30%" r="70%">
              <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
              <stop offset="0.45" stopColor="#fff" stopOpacity="0" />
            </radialGradient>
          </defs>
          {[
            { x: 40, y: 120, r: 22, c: "#b3202a" },
            { x: 110, y: 190, r: 30, c: "#c8962c" },
            { x: 180, y: 90, r: 18, c: "#fbf3e4" },
          ].map((o) => (
            <g key={o.x}>
              <line x1={o.x} y1={0} x2={o.x} y2={o.y - o.r - 6} />
              <rect x={o.x - 6} y={o.y - o.r - 7} width={12} height={8} rx={2} fill="#c8962c" />
              <circle cx={o.x} cy={o.y} r={o.r} fill={o.c} />
              <circle cx={o.x} cy={o.y} r={o.r} fill="url(#shine)" />
            </g>
          ))}
        </svg>
        <div className="drift" aria-hidden="true" />
      </section>

      <div className="steps">
        <div className="step"><span className="n">1</span><b>Make a wish.</b>What&apos;s a gift you&apos;d really love?</div>
        <div className="step"><span className="n">2</span><b>Grant someone&apos;s wish.</b>Cover the whole gift, or chip in with others.</div>
        <div className="step"><span className="n">3</span><b>Get yours granted.</b>Someone out there has your back.</div>
      </div>

      <h2 className="section">Top of the list</h2>
      <div className="grid">
        {wishes.slice(0, 8).map((w) => <WishCard key={w.id} wish={w} />)}
      </div>
      <div className="pager"><Link href="/feed" className="btn secondary">See all wishes</Link></div>
    </>
  );
}
