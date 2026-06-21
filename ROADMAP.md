# Roadmap

Future improvements for HMC-Cycling.org.

## Durable Order Ledger

Priority: high after checkout-to-fulfillment reconciliation IDs.

Recommendation: add a minimal Cloudflare D1-backed order ledger so the Worker preserves the order context it already sees during checkout and fulfillment.

Why:

- Stripe and Printful remain the financial sources of truth, but their CSV exports may omit metadata, line items, customer identifiers, or cost breakdowns.
- Current KV idempotency stores only `stripe_session_id -> processed` for 30 days.
- The Worker is the one place that sees the full chain: cart, Stripe Checkout Session, webhook, and Printful order result.

Target state:

- Store one durable order row per Stripe Checkout Session.
- Store order item rows with product slug, color, size, quantity, retail price, and Printful variant ID.
- Store Printful order IDs and reconciliation status.
- Keep PII minimal; prefer no full shipping addresses and consider hashing customer email.
- Keep KV only as an optional short-term idempotency guard, not the permanent order record.

Design doc: [`docs/order-ledger-design.md`](docs/order-ledger-design.md)

## WebP + Responsive Images (eleventy-img) ✓

Status: **done** — PR #4, commit `f8614fc`. Design:
[`docs/webp-responsive-images-design.md`](docs/webp-responsive-images-design.md).

Shirt images now serve WebP at viewport-appropriate widths with a PNG fallback:
~680 KB (800px PNG) → **~18 KB delivered** at the rendered size (~11× further on
the wire); homepage imagery on first load well under 1 MB.

- `src/_data/products.js` reads the raw `products.source.json` and runs
  `@11ty/eleventy-img` over each color's front/back image, emitting `webp` + `png`
  at `[320, 480, 768]` into `_site/img/` (gitignored via `_site/`). It exports the
  enriched `products` global where each image is `{ src, srcset, width, height }`.
- The random-color / swatch / front-back swaps in `src/index.liquid` set
  `src` + `srcset` + `sizes`; `Cart.add` passes the `.src` string.
- Raw catalog moved to `products.source.json` (repo root); `sync-products.js`
  writes there so the data file owns the enrichment.
- Decisions: `srcset` (WebP) + `src` (PNG) fallback, not `<picture>`;
  generate-at-build, gitignored; 800px PNGs kept as source/fallback.

Possible later: AVIF, `<picture>` art-direction, LQIP blur-up; shrink the
still-~960 KB about-page logo (separate, not data-driven).

## Checkout-to-Fulfillment Reconciliation IDs ✓

Status: **done** — deployed 2026-06-05, commit `2b2f4b1`.

- Stripe Checkout Sessions include `metadata.site = hmc` and `metadata.printful_store_id = 17828143`.
- Printful orders use the Stripe Checkout Session ID as `external_id`.
- Printful line items have deterministic external IDs (`${session.id}-1`, `${session.id}-2`, …).
- `retail_costs.shipping` is populated from `session.total_details.amount_shipping` when present.
