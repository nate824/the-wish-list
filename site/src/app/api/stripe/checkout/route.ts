import { fail } from "@/lib/api";

// Retired: hosted Checkout fixed the amount before we could see the card's country, so it
// couldn't add the non-US card fee. Card gifts now go through /api/stripe/pay.
export async function POST() {
  return fail("Please refresh the page and pay with the card form.", 410);
}
