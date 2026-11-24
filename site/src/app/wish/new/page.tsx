import Link from "next/link";
import { redirect } from "next/navigation";
import { DEMO_MODE } from "@/lib/config";
import { getMe, getMyDraft } from "@/lib/data";
import { STRIPE_ENABLED } from "@/lib/payments/stripe";
import { WishForm } from "./WishForm";

export const dynamic = "force-dynamic";

export default async function NewWish() {
  const [me, draft] = await Promise.all([getMe(), getMyDraft()]);
  if (!DEMO_MODE && !me) redirect("/login?next=/wish/new");

  const willPublish = DEMO_MODE || !!me?.canPost;
  return (
    <div style={{ maxWidth: 560, margin: "40px auto" }} className="stack">
      <h2 className="section" style={{ margin: 0 }}>Make a wish</h2>
      {draft && !willPublish ? (
        <div className="panel stack">
          <p style={{ margin: 0 }}>
            <b>Your wish is saved and waiting.</b> Fund anyone&apos;s wish, even a small one, and{" "}
            <Link href={`/wish/${draft.id}`}>yours</Link> goes live right away.
          </p>
          <Link href="/feed" className="btn">Find a wish to fund</Link>
        </div>
      ) : (
        <>
          {me?.isFounding && me.canPost && (
            <div className="notice ok">You&apos;re one of the Founding 100. Your first wish goes live free.</div>
          )}
          {!willPublish && (
            <div className="notice">
              Write your wish now. It stays private until you fund someone else&apos;s wish, then it goes live automatically.
            </div>
          )}
          <WishForm stripeEnabled={STRIPE_ENABLED} willPublish={willPublish} />
        </>
      )}
    </div>
  );
}
