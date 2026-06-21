# HMC — HMC-Cycling.org

A static ecommerce site built with Eleventy and deployed to Cloudflare Pages, using Stripe for payment processing and a Cloudflare Worker for checkout and fulfillment. Printful is integrated via API for print-on-demand fulfillment.

**Live site:** https://hmc-cycling.org

## Stack

- **Static site generator:** Eleventy (11ty) v3
- **Hosting:** Cloudflare Pages (free tier)
- **Payments:** Stripe (2.9% + 30¢ per transaction, no monthly fee)
- **Backend:** Cloudflare Worker
- **Idempotency:** Cloudflare KV
- **Fulfillment:** Printful API (Manual Order / API store)
- **Source control:** GitHub (nopolabs/HMC)

## Monthly cost

| Service | Cost |
|---|---|
| Cloudflare Pages | $0 |
| Cloudflare Workers | $0 (free tier) |
| Cloudflare KV | $0 (free tier) |
| Stripe | 2.9% + 30¢ per transaction |
| Domain | ~$1 amortized |
| **Total fixed cost** | **~$0/month** |

## Project structure

```
hmc/
├── src/
│   ├── _includes/
│   │   └── layout.njk        # Shared HTML layout (nav, footer, cart drawer + JS)
│   ├── _data/
│   │   ├── products.json     # Generated product catalog — do not edit directly
│   │   └── site.json         # Site-wide flags (e.g. preview mode)
│   ├── images/               # Product photos
│   ├── styles.css            # Site styles
│   ├── index.njk             # Home page — product cards with Add to Cart
│   ├── about.njk             # About page
│   ├── contact.njk           # Contact page
│   └── success.njk           # Order confirmation page (clears cart)
├── worker/
│   ├── src/
│   │   ├── index.js          # Cloudflare Worker — checkout and webhook handlers
│   │   └── products.js       # Generated product catalog for Worker — do not edit directly
│   ├── wrangler.json         # Worker configuration
│   ├── .dev.vars             # Local secrets (never commit — in .gitignore)
│   └── package.json
├── products-config.json      # Source of truth for product definitions
├── sync-products.js          # Syncs products from Printful → products.json + products.js
├── eleventy.config.cjs       # Eleventy config (input: src/, output: _site/)
├── package.json
└── .gitignore
```

## How it works

1. Customer browses products and clicks **Add to Cart** (size must be selected)
2. Cart state is stored in `localStorage` and shown in a cart drawer
3. Customer clicks **Checkout** in the cart drawer
4. Browser POSTs cart items to `POST /checkout` on the Worker
5. Worker builds Stripe line items and creates a Checkout Session, returns the Stripe URL
6. Browser redirects customer to Stripe's hosted payment page
7. Customer completes payment on Stripe; Stripe sends a receipt email automatically
8. Stripe fires a `checkout.session.completed` webhook to `POST /webhook`
9. Worker validates the Stripe webhook signature
10. Worker checks Cloudflare KV for idempotency (prevents duplicate orders on retries)
11. Worker creates and confirms a Printful order via the Printful API
12. Customer is redirected to `/success`, which clears the cart

## Shipping

Shipping is US-only, calculated per order at checkout:

- First item: **$4.75**
- Each additional item: **+$2.20**

This matches Printful's actual shipping rates for t-shirts. The amount is calculated in the Worker and passed to Stripe when the session is created.

## Preview mode

`src/_data/site.json` has a `preview` flag. When `true`:
- Products can be added to the cart normally
- The Checkout button in the cart is disabled and shows "Coming soon"

Useful for sharing the site for feedback before going live.

## Local development

```bash
# Eleventy site
npm install
npm start            # dev server at http://localhost:8080

# Worker
cd worker
npm install
npm run dev          # Worker at http://localhost:8787
```

### Local secrets

Create `worker/.dev.vars` (never commit this file):

```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
PRINTFUL_API_KEY=...
```

### Local webhook testing

Install the Stripe CLI and run:

```bash
stripe listen --forward-to http://localhost:8787/webhook
```

This forwards Stripe webhook events to your local Worker and prints the `STRIPE_WEBHOOK_SECRET` to use in `.dev.vars`.

## Adding or changing products

`products-config.json` is the single source of truth. Never edit `products.source.json` or `worker/src/products.js` directly — they are generated files.

To add or update a product, edit `products-config.json` then run:

```bash
npm run sync
```

This fetches current variant and sizing data from Printful and regenerates both output files.

To list available products in your Printful store:

```bash
node sync-products.js --list
```

## Deployment

### Eleventy site

Deployment is automatic — push to `main` on GitHub and Cloudflare Pages builds and deploys.

- Build command: `npm run build`
- Build output directory: `_site`

### Cloudflare Worker

Deploy worker first, then push frontend changes.

```bash
cd worker
npm run deploy
```

Worker URL: `https://hmc-worker.danrevel.workers.dev`
Worker routes: `hmc-cycling.org/checkout*` and `hmc-cycling.org/webhook*`

### Production secrets

```bash
cd worker
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put PRINTFUL_API_KEY
```

## Printful setup

- Store type: **Manual Order / API** (not Squarespace or Shopify)
- Store ID: `17828143`
- Products must be created and synced in this store
- API token must have order read/write permissions scoped to this store

## Idempotency

Stripe retries webhooks on failure. To prevent duplicate Printful orders, each processed Stripe session ID is stored in Cloudflare KV (`ORDERS` namespace) with a 30-day TTL. Subsequent webhook retries for the same session are ignored.

## Customer emails

Receipt emails are sent automatically by Stripe after payment. Enable in the Stripe Dashboard under **Settings → Business → Customer emails → Successful payments**.
