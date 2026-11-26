import { usd } from "@/lib/config";
import type { PublicWish } from "@/lib/types";

function daysLeft(iso: string) {
  const d = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400_000);
  return d <= 0 ? "ends today" : d === 1 ? "1 day left" : `${d} days left`;
}

/** Progress toward a pooled wish: solid = money in, striped = saved cards waiting to be charged. */
export function FundingBar({ wish, detailed = false }: {
  wish: Pick<PublicWish, "price_usd_cents" | "collected_usd_cents" | "pledged_usd_cents" | "funding_deadline">;
  detailed?: boolean;
}) {
  const price = wish.price_usd_cents;
  const got = Math.min(wish.collected_usd_cents, price);
  const promised = Math.min(wish.pledged_usd_cents, price - got);
  if (!detailed && got + promised === 0) return null;
  const pct = (c: number) => `${(c / price) * 100}%`;
  const left = price - got - promised;

  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="fundbar" aria-label={`${usd(got + promised)} of ${usd(price)} raised or pledged`}>
        <span className="got" style={{ width: pct(got) }} />
        <span className="promised" style={{ width: pct(promised) }} />
      </div>
      <div className="hint">
        {usd(got + promised)} of {usd(price)}
        {detailed && promised > 0 && <> · {usd(promised)} pledged</>}
        {wish.funding_deadline && promised > 0 && <> · {daysLeft(wish.funding_deadline)}</>}
        {detailed && left > 0 && <> · {usd(left)} to go</>}
      </div>
    </div>
  );
}
