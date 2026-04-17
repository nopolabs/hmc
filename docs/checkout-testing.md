# Checkout Testing Guide

## Overview

Stripe has fully separate **test** and **live** environments, each with their own API keys and webhook signing secrets. The worker can run in test mode while pointing at the real Printful API — Printful doesn't know or care whether the payment was real. Test orders will need to be cancelled manually in the Printful dashboard.

| | Test mode | Live mode |
|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_...` | `sk_live_...` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` (test endpoint) | `whsec_...` (live endpoint) |
| Stripe dashboard | "Test mode" toggle on | Test mode off |
| Card used | `4242 4242 4242 4242` | Real card |
| Printful orders | Real — cancel manually | Real — fulfilled |
| Charges | None | Real money |

---

## Secret management

Secrets are stored in two local files (both gitignored):

| File | Purpose |
|---|---|
| `worker/.dev.vars` | Test mode secrets (`sk_test_...`) |
| `worker/.prod.vars` | Live mode secrets (`sk_live_...`) |

Copy the example files to get started:
```bash
cp worker/.dev.vars.example worker/.dev.vars    # fill in test keys
cp worker/.prod.vars.example worker/.prod.vars  # fill in live keys
```

`PRINTFUL_API_KEY` is the same in both files — Printful has no test mode.

### Switching modes and deploying

From the `worker/` directory:

```bash
npm run deploy:dev    # push test secrets + deploy
npm run deploy:prod   # push live secrets + deploy
```

To push secrets only (without deploying, e.g. when rotating a key):
```bash
npm run secrets:dev
npm run secrets:prod
```

`npm run deploy` deploys without touching secrets (uses whatever is already set in Cloudflare).

---

## One-time setup: register the webhook endpoint

This must be done separately for test mode and live mode.

**Test mode** — Stripe dashboard → Test mode on → Developers → Webhooks:
1. Add endpoint: `https://hmc-worker.danrevel.workers.dev/webhook`
2. Select event: `checkout.session.completed`
3. Copy the signing secret (`whsec_...`) → put this in `worker/.dev.vars` as `STRIPE_WEBHOOK_SECRET`

**Live mode** — repeat the same steps with Test mode off, using your live keys.

---

## Running a test order

1. Deploy in test mode: `cd worker && npm run deploy:dev`
2. Visit hmc-cycling.org
3. Select a product, color, and size — add to cart
4. Click Checkout
5. Use card `4242 4242 4242 4242`, any future expiry, any CVV, any ZIP
6. Enter a real shipping address (Printful will use it)
7. Complete the order

**Verify in Stripe** (Test mode → Developers → Webhooks → your endpoint → Recent deliveries):
- `checkout.session.completed` event should show status **200**
- A 400 response means signature mismatch — wrong `STRIPE_WEBHOOK_SECRET`
- A connection error means the worker URL is incorrect

**Verify in Printful dashboard**:
- A new order should appear with the correct variant, quantity, and shipping address
- Cancel the order manually to avoid fulfillment charges

---

## Going live

Once test mode passes:

```bash
cd worker && npm run deploy:prod
```

No code changes required — only secret rotation.

---

## Troubleshooting

**Worker returns 400 on checkout POST**
Open browser devtools → Network tab → look at the POST `/checkout` response body. It will name exactly which field (`slug`, `color`, `size`) wasn't found in the worker's product catalog. Usually means `node sync-products.js` wasn't re-run after a products-config change, or the worker wasn't redeployed after sync.

**Webhook not delivered / 400 from worker**
- 400 = signature verification failed → `STRIPE_WEBHOOK_SECRET` doesn't match the endpoint's signing secret, or you're sending test events to a worker configured with live secrets (or vice versa)
- Not delivered = wrong webhook URL, or worker isn't deployed

**Wrong Printful variant ordered**
The `printful_variant_id` in `worker/src/products.js` comes from the last `node sync-products.js` run. If the Printful catalog changed since then, re-sync and redeploy the worker.

**Duplicate Printful order after replaying a webhook**
The worker is idempotent — if the Stripe session ID is already in KV (`ORDERS` namespace), it logs "Already processed session:" and returns 200 without creating a second order. Safe to replay events from the Stripe dashboard.

**Test card declined**
Use exactly `4242 4242 4242 4242`. Other [Stripe test cards](https://stripe.com/docs/testing#cards) simulate declines, authentication, etc. — useful for testing error states.
