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

## Checkout-to-Fulfillment Reconciliation IDs ✓

Status: **done** — deployed 2026-06-05, commit `2b2f4b1`.

- Stripe Checkout Sessions include `metadata.site = hmc` and `metadata.printful_store_id = 17828143`.
- Printful orders use the Stripe Checkout Session ID as `external_id`.
- Printful line items have deterministic external IDs (`${session.id}-1`, `${session.id}-2`, …).
- `retail_costs.shipping` is populated from `session.total_details.amount_shipping` when present.
