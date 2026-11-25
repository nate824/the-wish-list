"use server";
import { redirect } from "next/navigation";
import { DEMO_MODE } from "@/lib/config";
import { isValidBtcAddress } from "@/lib/payments/btc";
import { validateLightningAddress } from "@/lib/payments/lightning";
import { supabaseServer } from "@/lib/supabase/server";

export type PostState = { error?: string };

export async function postWish(_prev: PostState, form: FormData): Promise<PostState> {
  if (DEMO_MODE) return { error: "Posting is off in demo mode. Connect Supabase first." };

  const title = String(form.get("title") ?? "").trim();
  const description = String(form.get("description") ?? "").trim();
  const price = Number(form.get("price"));
  const isAnonymous = form.get("anonymous") === "on";
  const displayName = String(form.get("display_name") ?? "").trim();
  const bio = String(form.get("bio") ?? "").trim();
  const btc = String(form.get("btc_address") ?? "").trim();
  const ln = String(form.get("lightning_address") ?? "").trim().toLowerCase();
  const stripe = form.get("accepts_stripe") === "on";

  if (title.length < 3) return { error: "Give your wish a title." };
  if (!Number.isFinite(price) || price < 5) return { error: "Minimum wish price is $5." };
  const maxPrice = Number(form.get("max_price_cents")) / 100;
  if (maxPrice > 0 && price > maxPrice) return { error: `Wishes can be up to $${maxPrice.toLocaleString()} for now.` };
  if (!btc && !ln && !stripe) return { error: "Add at least one way to receive the gift." };
  if (btc && !isValidBtcAddress(btc)) return { error: "That Bitcoin address isn't valid (mainnet)." };
  if (ln) {
    const v = await validateLightningAddress(ln);
    if (!v.ok) return { error: v.reason };
  }
  if (!isAnonymous && !displayName) return { error: "Add a display name, or post anonymously." };

  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login?next=/wish/new");

  if (!isAnonymous) {
    await sb.from("profiles").update({ display_name: displayName, bio: bio || null, is_anonymous: false }).eq("user_id", user.id);
  }

  // TODO: Turnstile check here (plan section 6)
  const { data: id, error } = await sb.rpc("post_wish", {
    p_title: title,
    p_description: description,
    p_price_usd_cents: Math.round(price * 100),
    p_is_anonymous: isAnonymous,
    p_btc_address: btc,
    p_lightning_address: ln,
    p_accepts_stripe: stripe,
  });
  if (error) {
    if (error.message.includes("PRICE_CAP") || error.message.includes("OPEN_LIMIT")) {
      return { error: error.message.replace(/^.*(PRICE_CAP|OPEN_LIMIT): /, "") + "." };
    }
    return { error: error.message };
  }
  // Always live. Where it ranks depends on how much the wisher gives.
  redirect(`/wish/${id}?posted=1`);
}
