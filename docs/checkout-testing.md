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

Secrets are stored permanently in Cloudflare under two environments:

| Environment | Worker name | Stripe keys |
|---|---|---|
| default (prod) | `hmc-worker` | `sk_live_...` |
| `dev` | `hmc-worker-dev` | `sk_test_...` |

### Where secrets live

Secrets are stored in Cloudflare only — no local `.vars` files are retained. To deploy or rotate keys you pull values from their respective dashboards:

| Secret | Where to find it |
|---|---|
| `STRIPE_SECRET_KEY` (test) | Stripe dashboard → Test mode on → Developers → API keys |
| `STRIPE_SECRET_KEY` (live) | Stripe dashboard → Test mode off → Developers → API keys |
| `STRIPE_WEBHOOK_SECRET` (test) | Stripe dashboard → Test mode on → Developers → Webhooks → endpoint → Signing secret |
| `STRIPE_WEBHOOK_SECRET` (live) | Stripe dashboard → Test mode off → Developers → Webhooks → endpoint → Signing secret |
| `PRINTFUL_API_KEY` | Printful dashboard → Settings → API |

`PRINTFUL_API_KEY` is the same in both environments — Printful has no test mode.

### Rotating a key

Use `wrangler secret put` directly (prompts for value):

```bash
wrangler secret put STRIPE_SECRET_KEY --env dev   # test key → hmc-worker-dev
wrangler secret put STRIPE_SECRET_KEY             # live key → hmc-worker
```

### Reconstructing .dev.vars for local development

`wrangler dev` (local dev server) requires a `.dev.vars` file. Recreate it from the dashboards above:

```bash
cp worker/.dev.vars.example worker/.dev.vars
# fill in: STRIPE_SECRET_KEY (test), STRIPE_WEBHOOK_SECRET (test), PRINTFUL_API_KEY
```

`.dev.vars` is gitignored — do not commit it.

### Switching modes and deploying

From the `worker/` directory:

```bash
npm run deploy:dev    # deploy to hmc-worker-dev (test mode)
npm run deploy:prod   # deploy to hmc-worker (live mode)
```

`npm run deploy` is an alias for `deploy:prod`.

---

## One-time setup: register the webhook endpoint

This must be done separately for test mode and live mode.

**Test mode** — Stripe dashboard → Test mode on → Developers → Webhooks:
1. Add endpoint: `https://hmc-worker-dev.danrevel.workers.dev/webhook`
2. Select event: `checkout.session.completed`
3. Copy the signing secret (`whsec_...`) → `wrangler secret put STRIPE_WEBHOOK_SECRET --env dev`

**Live mode** — Stripe dashboard → Test mode off → Developers → Webhooks:
1. Add endpoint: `https://hmc-worker.danrevel.workers.dev/webhook`
2. Select event: `checkout.session.completed`
3. Copy the signing secret (`whsec_...`) → `wrangler secret put STRIPE_WEBHOOK_SECRET`

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
