import Link from "next/link";
import { WishCard } from "@/components/WishCard";
import { TIERS, type Tier } from "@/lib/config";
import { getFeed } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function Feed({ searchParams }: { searchParams: Promise<{ tier?: string; page?: string }> }) {
  const sp = await searchParams;
  const tier: Tier | "all" = TIERS.some((t) => t.key === sp.tier) ? (sp.tier as Tier) : "all";
  const page = Math.max(0, Number(sp.page ?? 0) || 0);
  const { wishes, hasMore } = await getFeed(tier, page);
  const href = (t: string, p = 0) => {
    const q = new URLSearchParams();
    if (t !== "all") q.set("tier", t);
    if (p) q.set("page", String(p));
    const s = q.toString();
    return s ? `/feed?${s}` : "/feed";
  };

  return (
    <div style={{ paddingTop: 32 }}>
      <h2 className="section">Wishes waiting to be funded</h2>
      <div className="tabs">
        <Link href={href("all")} className={tier === "all" ? "on" : ""}>All</Link>
        {TIERS.map((t) => (
          <Link key={t.key} href={href(t.key)} className={tier === t.key ? "on" : ""}>
            {t.label} <span className="hint">{t.range}</span>
          </Link>
        ))}
      </div>
      {wishes.length === 0 ? (
        <div className="notice">Nothing here right now. Every wish in this tier has been funded.</div>
      ) : (
        <div className="grid">{wishes.map((w) => <WishCard key={w.id} wish={w} />)}</div>
      )}
      <div className="pager">
        {page > 0 && <Link className="btn secondary" href={href(tier, page - 1)}>Previous</Link>}
        {hasMore && <Link className="btn secondary" href={href(tier, page + 1)}>More wishes</Link>}
      </div>
    </div>
  );
}
