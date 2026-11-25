import Link from "next/link";
import { WishCard } from "@/components/WishCard";
import { FOUNDING_CAP } from "@/lib/config";
import { getFeed, getFoundingSpotsLeft } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [spotsLeft, { wishes }] = await Promise.all([getFoundingSpotsLeft(), getFeed("all", 0)]);
  return (
    <>
      <section className="hero">
        {spotsLeft > 0 && (
          <div className="counter">
            <strong>{spotsLeft}</strong> of {FOUNDING_CAP} founding spots left: post your first wish free
          </div>
        )}
        <h1>The Wish List</h1>
        <p className="lead">A worldwide Secret Santa.</p>
        <div className="row">
          <Link href="/wish/new" className="btn">Make a wish</Link>
          <Link href="/feed" className="btn secondary">Grant a wish</Link>
        </div>
      </section>

      <div className="steps">
        <div className="step"><span className="n">1</span><b>Make a wish.</b>What&apos;s a gift you&apos;d really love?</div>
        <div className="step"><span className="n">2</span><b>Grant someone&apos;s wish.</b>A stranger somewhere is hoping.</div>
        <div className="step"><span className="n">3</span><b>Get yours granted.</b>Someone out there has your back.</div>
      </div>

      <h2 className="section">Waiting longest</h2>
      <div className="grid">
        {wishes.slice(0, 8).map((w) => <WishCard key={w.id} wish={w} />)}
      </div>
      <div className="pager"><Link href="/feed" className="btn secondary">See all wishes</Link></div>
    </>
  );
}
