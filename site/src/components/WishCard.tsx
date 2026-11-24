import Link from "next/link";
import { usd } from "@/lib/config";
import type { PublicWish } from "@/lib/types";

function age(iso: string) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000);
  return d <= 0 ? "today" : d === 1 ? "1 day waiting" : `${d} days waiting`;
}

export function WishCard({ wish }: { wish: PublicWish }) {
  return (
    <Link href={`/wish/${wish.id}`} className="card">
      <span className={`pill ${wish.tier}`}>{wish.tier}</span>
      <div className="price">{usd(wish.price_usd_cents)}</div>
      <div className="title">{wish.title}</div>
      <div className="who">
        {wish.is_anonymous ? "Anonymous" : wish.display_name} · {age(wish.created_at)}
      </div>
    </Link>
  );
}
