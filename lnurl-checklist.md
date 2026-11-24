# LNURL / Lightning: What We Need

Companion to `wish-list-build-plan.md` (section 5.3). Not legal advice.

## The key point

**The site runs no node and holds no funds.** Each wisher brings their own Lightning address. The site only:
1. resolves that address,
2. asks it for an invoice,
3. shows the invoice to the buyer,
4. polls a `verify` URL to confirm it was paid.

So there's no Lightning account for the site itself to create in v1. Everything you set up is just for testing.

## Flows we use (and skip)

| Spec | What it is | Use? |
|---|---|---|
| LUD-16 Lightning address (`name@domain`) | How wishers give us their payout | **Yes** |
| LUD-06 LNURL-pay | Turns that address into an invoice | **Yes** |
| LUD-21 verify | Lets us confirm payment without a node | **Yes, when available.** Without it, the wisher confirms (see below) |
| LUD-12 comments | Attach a note to the payment | Optional: put `wishlist:<wish_id>` in the comment if the provider allows it |
| LUD-09 successAction | Message shown to buyer after paying | Optional, nice touch |
| LUD-03 LNURL-withdraw | Site pays users out | **No.** That means the site holds funds. Skip |
| LNURL-auth (LUD-04) | Login with a wallet | No for v1. Email magic link is enough |

## Provider options (for wishers, and for your testing)

LUD-21 support changes, so **none of these is confirmed yet**. The site's validation step (request a test invoice and look for `verify`) is the real check. Test before listing any as "known good."

| Option | Custody | KYC | Notes |
|---|---|---|---|
| Alby Hub (self-hosted or Alby Cloud) | Self-custody | None | Most likely to support verify. Best first test |
| LNbits (self-hosted, LNURLp extension) | Whoever runs it | None | Check the extension version for verify |
| Coinos | Custodial | None | Easy signup. Test verify |
| Blink | Custodial | Light, by region | Test verify |
| Strike, Cash App, Wallet of Satoshi | Custodial | Yes (Strike, Cash App) | Huge user bases. Verify support unknown or missing. If they fail, many normal users can't receive Lightning |

That last row is the real risk: if the popular apps don't support verify, the Lightning rail only works for Bitcoin-native people. Find out before building UX around it.

Self-hosting your own node (LND, CLN, Phoenixd) only matters later if the site wants to take a fee or custody. Not v1.

## Test results (2026-11-23)

- **Coinos:** verify ✅. Full loop proven: invoice paid from Phoenix, verify returned `settled: true`, preimage hashed to the payment hash.
- **Strike:** verify ❌ (invoice works, `verify: null`).
- **Phoenix:** great sender. Its ₿ address is BOLT12 (BIP-353), not LNURL, so it can't be a receiver here.

**Decision (Nate):** accept no-verify addresses. Buyer taps "I've paid", wisher confirms on `/gifts`. Risky confirmations (new wisher account, same IP, reciprocal pair, too many new-account buyers) go to admin review. Built in migration `0005_ln_wisher_confirm.sql`.

## What you (Nate) need to do

- [ ] Get **two** Lightning wallets: one to send, one to receive with a Lightning address. Alby Hub as receiver is the best bet.
- [ ] Put ~10k–20k sats in the sender.
- [ ] Run the verify test on each candidate provider (below). Record pass/fail in a "known good" list.
- [x] Decided: no-verify providers fall back to wisher confirmation.
- [ ] Decide price tolerance and quote lock (plan says ±3%, 15 min) for USD to sats.

No keys, no API accounts, no env vars needed for Lightning.

### Verify test (run anywhere with curl + jq)

```bash
ADDR=you@provider.com
USER=${ADDR%@*}; DOMAIN=${ADDR#*@}
CB=$(curl -s "https://$DOMAIN/.well-known/lnurlp/$USER" | jq -r .callback)
curl -s "$CB?amount=1000000" | jq '{pr, verify}'   # 1000 sats, amount is in millisats
```
Pass = `verify` is a URL. Then `curl -s <verify>` should show `settled: false` (and `true` after you pay it).

## Integration points for the website build

All Lightning calls happen **server-side** (most LNURL endpoints don't send CORS headers, and it keeps the logic trusted).

1. **Save wish (validate address):** parse `name@domain`, fetch `/.well-known/lnurlp/name`, check `tag == "payRequest"`, request a test invoice, require `verify`. Store `lightning_address`. Reject with a clear message if any step fails.
2. **Start purchase:** convert USD to sats (mempool.space `/api/v1/prices`), check against `minSendable`/`maxSendable` (millisats), call `callback?amount=<msats>`. Store `ln_invoice`, `ln_verify_url`, `ln_payment_hash`, quote time.
3. **Check the invoice before showing it:** decode the BOLT11 (e.g. `light-bolt11-decoder`), confirm the amount matches and the description hash equals sha256 of the `metadata` (LUD-06). Stops a malicious endpoint swapping amounts.
4. **Show it:** QR of the invoice + `lightning:<invoice>` deep link + copy button + expiry countdown.
5. **Confirm payment:** poll `ln_verify_url` (client pings our API every few seconds, our API calls verify). On `settled: true`, set `verified`, `settled_at`. Add a background re-check for buyers who close the tab.
6. **Expiry:** if the invoice expires unpaid, mark the purchase `rejected` and let the buyer get a fresh one.
7. **Uniqueness:** `ln_payment_hash` unique; one settled payment per wish.
8. **SSRF guard:** the domain is user-supplied. Block private/localhost IPs, enforce HTTPS, short timeouts, cap response size.
9. **Rate-limit** invoice creation per user and per wish so nobody spams a wisher's provider.

Suggested deps: `light-bolt11-decoder`, `qrcode`, plain `fetch`. No Lightning SDK needed.

## Legal and KYC notes

- **Non-custodial is the safe lane.** The site never receives or forwards sats, so it's acting like software that displays someone else's payment request. US FinCEN's 2019 guidance treats that differently from money transmission, but confirm with a lawyer, especially for running a marketplace.
- **KYC lives with the wisher's provider,** not with us. Custodial apps do their own; self-custody has none.
- **Sanctions:** worldwide audience means people in sanctioned regions could post addresses. Ask the lawyer whether to geo-block sanctioned countries.
- **Taxes:** receivers may owe tax on crypto gifts depending on country. Add a "you're responsible for your own taxes" line in terms.
- **Terms to add:** no guarantee wishes get funded, payments are final and peer-to-peer, we don't custody funds, Lightning payments can't be refunded by us.
