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

## WebP + Responsive Images (eleventy-img)

Priority: medium — follow-up to the 2026-06 image optimization (mockups resized
2000px → 800px PNG, ~177 MB → ~35 MB, ~680 KB per image).

Recommendation: introduce the `@11ty/eleventy-img` build pipeline to serve modern
formats at viewport-appropriate sizes, replacing the single hand-resized PNG per
image.

Why:

- PNG at 800px is still ~300–680 KB per shirt. The same image as **WebP at the
  size the card actually renders (~340px, retina ~680px) lands around 40–80 KB**
  — roughly a further **10×** on the wire, and the homepage loads six mains plus
  thumbnails.
- Cards display at ~340px in a 3-col grid (2-col under 800px), so a single 800px
  asset over-serves most viewports; responsive `srcset`/`sizes` lets the browser
  pick the smallest sufficient variant.

Target state:

- Generate WebP (and a PNG/JPEG fallback) at a few widths (e.g. 320 / 480 / 768 /
  960) for each mockup, with `srcset` + `sizes` and `width`/`height` for layout
  stability.
- Keep one set of source images; derivatives are generated at build and not
  committed (gitignore the output dir / eleventy-img cache).

Complications to design around:

- Image paths are **data-driven**, not inline in templates: `src/_data/products.json`
  (`main_image`, `colors[].images.front/back`) and the client-side `data-colors`
  JSON the swatch picker reads. eleventy-img is easiest on template-inline images,
  so this needs either a render-time transform over the resolved product data or a
  pre-generation step that rewrites the data paths to point at the derivatives.
- The random-color-on-load swap and the front/back thumbnail swap set
  `img.src` from JS, so the chosen variant must carry its responsive sources too
  (e.g. swap a `<picture>`/`srcset`, not just `src`), or accept a single
  well-chosen width for the JS-swapped image.
- Coordinate with the Printful sync (`sync-products.js`) so re-syncing regenerates
  or re-points derivatives rather than dropping back to full-res PNGs.

Estimated payoff: homepage image transfer from ~4 MB (post-resize) to well under
1 MB; further gains on slower connections from right-sized variants.

## Checkout-to-Fulfillment Reconciliation IDs ✓

Status: **done** — deployed 2026-06-05, commit `2b2f4b1`.

- Stripe Checkout Sessions include `metadata.site = hmc` and `metadata.printful_store_id = 17828143`.
- Printful orders use the Stripe Checkout Session ID as `external_id`.
- Printful line items have deterministic external IDs (`${session.id}-1`, `${session.id}-2`, …).
- `retail_costs.shipping` is populated from `session.total_details.amount_shipping` when present.
