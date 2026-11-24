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
        <h1>Give a gift. Then make a wish.</h1>
        <p className="lead">
          A worldwide gift exchange. Fund a stranger&apos;s wish, any size, and you unlock one of your own.
          Every wish here is waiting on someone like you.
        </p>
        <div className="row">
          <Link href="/feed" className="btn">Fund a wish</Link>
          <Link href="/wish/new" className="btn secondary">Make a wish</Link>
        </div>
      </section>

      <div className="steps">
        <div className="step"><span className="n">1</span><b>Pick a wish</b>Oldest wishes come first, mixed across small, mid and big.</div>
        <div className="step"><span className="n">2</span><b>Send the gift</b>Pay the wisher directly with Bitcoin, Lightning, or card (soon). We never touch the money.</div>
        <div className="step"><span className="n">3</span><b>Post your own</b>One gift sent unlocks one wish. Anonymous or with your name, your call.</div>
      </div>

      <h2 className="section">Waiting longest</h2>
      <div className="grid">
        {wishes.slice(0, 8).map((w) => <WishCard key={w.id} wish={w} />)}
      </div>
      <div className="pager"><Link href="/feed" className="btn secondary">See all wishes</Link></div>
    </>
  );
}
