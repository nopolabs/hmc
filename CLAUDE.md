# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

HMC is a static ecommerce site for HMC-Cycling.org selling branded merchandise. It uses Eleventy for the static frontend, a Cloudflare Worker for checkout/webhook handling, Stripe for payments, and Printful for print-on-demand fulfillment.

## Commands

### Frontend (Eleventy)
```bash
npm start          # Dev server at localhost:8080 (eleventy --serve)
npm run build      # Build static site to _site/
```

### Product sync
```bash
node sync-products.js --init          # Generate products-config.json + data files from docs/printful-products.json (no API needed)
node sync-products.js --init --force  # Overwrite existing products-config.json
node sync-products.js                 # Full sync from Printful API (adds size guide data)
node sync-products.js --list          # List Printful products and their IDs
node sync-products.js --json          # Dump raw Printful API JSON
```

### Worker (from /worker/)
```bash
npm run dev        # Local worker at localhost:8787 (wrangler dev)
npm run deploy     # Deploy worker to Cloudflare
npm test           # Run tests with Vitest
```

## Architecture

**Frontend** (`src/`) is a static Eleventy site using Liquid templates, deployed to Cloudflare Pages automatically on git push to main. Product data is injected via `src/_data/products.json`.

**Worker** (`worker/`) is a Cloudflare Worker handling two routes:
- `POST /checkout` — receives a cart JSON payload, creates a Stripe Checkout session, returns `{ url }` for redirect
- `POST /webhook` — receives Stripe `checkout.session.completed` events, creates/confirms Printful orders

**Idempotency:** Cloudflare KV namespace `ORDERS` stores processed Stripe session IDs (30-day TTL) to prevent duplicate Printful orders.

**Preview mode:** `src/_data/site.json` has a `preview` flag — when `true`, the Checkout button is disabled with a "Coming soon" message.

## Product Data Model

Each product has two variant dimensions: **color** and **size**. Products map 1:1 to Printful sync products.

**`products-config.json`** is the source of truth for product configuration. Key fields per entry:
- `slug` — Printful `sync_product.external_id`; used as the product key throughout (URL, cart, worker)
- `printful_product_id` — Printful `sync_product.id`; used to fetch variant data
- `mockup_folder` — subfolder of `mockups/` containing this product's images
- `active` — when `false`, excluded from sync and not shown
- `name`, `description` — display overrides (fall back to Printful values)
- `price` — flat retail price for all variants/sizes (overrides Printful's size-based pricing)
- `main_image` — default hero image path (falls back to White front mockup)
- `color_order` — array of color names in display order; colors absent from the array are hidden

Never edit the generated files directly. Edit `products-config.json` and re-sync.

**`src/_data/products.json`** (generated) — consumed by Eleventy. Shape per product:
```json
{
  "slug": "...", "name": "...", "description": "...", "price": "20.00",
  "main_image": "/mockups/...",
  "colors": [{ "name": "White", "hex": "#FFFFFF", "images": { "front": "...", "back": "..." }, "sizes": [{ "size": "M", "external_id": "..." }] }],
  "size_guide": { "product_measure": {...}, "measure_yourself": {...} }
}
```

**`worker/src/products.js`** (generated) — consumed by the Worker. Shape:
```js
PRODUCTS[slug] = { name, price /* cents */, variants: { [color]: { [size]: { printful_variant_id } } } }
```

## Product Sync Workflow

1. `node sync-products.js --init` — reads `docs/printful-products.json` (fetch once with `--json`), writes `products-config.json` and preliminary data files. Run once to bootstrap; edit config as needed.
2. `node sync-products.js` — fetches live variant data + size guides from Printful API, writes final `src/_data/products.json` and `worker/src/products.js`.
3. Deploy the worker: `cd worker && npm run deploy`
4. Push the site: `git push` (Cloudflare Pages builds automatically)

## Mockup Images

Mockup images live in `mockups/{folder}/` and are served at `/mockups/...` in the built site. Folders map to Printful products:
- `womens_softstyle-front_and_back` / `womens_softstyle-front_only`
- `womens_relaxed-front_and_back` / `womens_relaxed-front_only`
- `unisex-front_and_back` / `unisex-front_only`

Filename convention: `{product-base}-{color-slug}-{front|back}-{id}.png` where color slug = color name lowercased with spaces replaced by hyphens (e.g. `"Irish Green"` → `irish-green`).

## Checkout Flow

The cart POST payload to the worker: `{ items: [{ slug, color, size, qty }] }`

Worker looks up `PRODUCTS[slug].variants[color][size].printful_variant_id`. Returns 400 if any combination is not found. Price is taken from `PRODUCTS[slug].price` (flat per-product, ignoring Printful's variant pricing).

## Cart (Frontend)

Cart state is stored in `localStorage` under key `hmc_cart`. Item shape: `{ slug, name, color, size, price, image, qty }`. Item identity is the `(slug, color, size)` triple.

On every page load, stale cart items are automatically purged: `_HMC_CATALOG` is a `Set` of all valid `"slug:color:size"` strings embedded at build time in `layout.liquid`. Any item not in the set is silently removed from localStorage before the cart badge renders.

## Environment Variables

Worker secrets (never committed):
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `PRINTFUL_API_KEY`

Copy `worker/.dev.vars.example` to `worker/.dev.vars` for local development. Production secrets are deployed via `wrangler secret put`.

## Cloudflare Workers

Retrieve current documentation before any Workers, KV, R2, D1, or other Cloudflare product task — knowledge may be outdated. Use the MCP Cloudflare tool or fetch from `https://developers.cloudflare.com/workers/`. Check limits at `/workers/platform/limits/`.

Run `npx wrangler types` after changing bindings in `wrangler.json`.

## Deployment

- **Frontend:** Automatic via Cloudflare Pages on push to `main`. Build command: `npm run build`, output: `_site/`.
- **Worker:** Manual — `cd worker && npm run deploy`. Worker URL: `https://hmc-worker.danrevel.workers.dev`.
- Printful Store ID: `17828143` (Manual Order / API store).
