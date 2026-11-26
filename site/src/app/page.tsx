import Link from "next/link";
import { WishCard } from "@/components/WishCard";
import { getFeed } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { wishes } = await getFeed("all", 0);
  return (
    <>
      <section className="hero">
        <h1>The Wish List</h1>
        <p className="lead">A worldwide Secret Santa.</p>
        <div className="row">
          <Link href="/wish/new" className="btn">Make a wish</Link>
          <Link href="/feed" className="btn secondary">Grant a wish</Link>
        </div>
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
