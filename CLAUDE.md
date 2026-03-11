# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

HMC is a static ecommerce site for HMC-Cycling.org selling branded merchandise. It uses Eleventy for the static frontend, a Cloudflare Worker for checkout/webhook handling, Stripe for payments, and Printful for print-on-demand fulfillment.

## Commands

### Frontend (Eleventy)
```bash
npm start          # Dev server at localhost:8080 (eleventy --serve)
npm run build      # Build static site to _site/
npm run sync       # Sync products from Printful to both frontends
```

### Worker (from /worker/)
```bash
npm run dev        # Local worker at localhost:8787 (wrangler dev)
npm run deploy     # Deploy worker to Cloudflare
npm test           # Run tests with Vitest
```

## Architecture

**Frontend** (`src/`) is a static Eleventy site using Nunjucks templates, deployed to Cloudflare Pages automatically on git push to main. Product data is injected via `src/_data/products.json`.

**Worker** (`worker/`) is a Cloudflare Worker handling two routes:
- `GET /checkout?slug=<slug>&size=<size>` — creates a Stripe Checkout session and redirects
- `POST /webhook` — receives Stripe `checkout.session.completed` events, creates/confirms Printful orders

**Idempotency:** Cloudflare KV namespace `ORDERS` stores processed Stripe session IDs (30-day TTL) to prevent duplicate Printful orders.

**Preview mode:** `src/_data/site.json` has a `preview` flag — when `true`, the "Buy Now" button is replaced with "Coming soon".

## Product Sync Workflow

`products-config.json` is the single source of truth for product definitions. Running `node sync-products.js` generates:
- `src/_data/products.json` — consumed by Eleventy templates
- `worker/src/products.js` — consumed by the Worker (prices in cents, variant IDs)

Never edit the generated files directly. Edit `products-config.json` and re-sync.

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
