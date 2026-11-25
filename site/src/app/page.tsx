import Link from "next/link";
import { WishCard } from "@/components/WishCard";
import { getFeed } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { wishes } = await getFeed("all", 0);
  return (
    <>
      <section className="hero">
        <h1>Make a wish. Give to move it up.</h1>
        <p className="lead">
          A worldwide gift exchange. Post a wish for free. Chip in on a stranger&apos;s, any amount, and yours
          climbs the list. The more you give, the more people see your wish.
        </p>
        <div className="row">
          <Link href="/feed" className="btn">Fund a wish</Link>
          <Link href="/wish/new" className="btn secondary">Make a wish</Link>
        </div>
      </section>

      <div className="steps">
        <div className="step"><span className="n">1</span><b>Post your wish</b>Up to $500. Anonymous or with your name, your call. It goes live right away.</div>
        <div className="step"><span className="n">2</span><b>Chip in on others</b>Any amount from $5. Cards are only charged once a wish is fully covered.</div>
        <div className="step"><span className="n">3</span><b>Climb the list</b>Wishes from people who give rank first. Givers get seen.</div>
      </div>

      <h2 className="section">Top of the list</h2>
      <div className="grid">
        {wishes.slice(0, 8).map((w) => <WishCard key={w.id} wish={w} />)}
      </div>
      <div className="pager"><Link href="/feed" className="btn secondary">See all wishes</Link></div>
    </>
  );
}
