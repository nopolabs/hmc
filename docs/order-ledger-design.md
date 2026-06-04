# Order Ledger Design

Design note for keeping a durable HMC order ledger in Cloudflare.

## Recommendation

Add a minimal order ledger backed by **Cloudflare D1**.

Stripe and Printful remain the financial sources of truth. The HMC ledger should be an operational and reconciliation record captured by the Worker while it has full context:

```text
cart -> Stripe Checkout Session -> Stripe webhook -> Printful order result
```

The ledger should not replace Stripe reports, Printful billing records, or accounting review. It should make reconciliation deterministic and reduce dependence on incomplete CSV exports.

## Current State

The Worker currently uses Cloudflare KV binding `ORDERS` for idempotency:

```text
stripe_session_id -> processed
```

That value expires after 30 days and does not preserve:

- item quantities
- retail subtotal/shipping/total
- Stripe session/payment identifiers beyond the key
- Printful order ID
- Printful fulfillment result
- Printful cost fields
- reconciliation status

This is enough to prevent duplicate fulfillment retries, but not enough to answer financial questions later.

## Why D1

Use D1 because order data is relational and should be queryable:

- one order has many order items
- one order may have multiple webhook/fulfillment events
- reports need grouping by date, payout, product, status, and reconciliation state

Do not use Workers KV as the primary order database. KV is useful for short-term idempotency and cache-like data, but it is key/value-shaped and eventually consistent.

Do not use Durable Objects initially. They are useful for serialized per-order workflows, but D1 is simpler for an order ledger and reporting.

## Data Model

Minimal schema:

```sql
CREATE TABLE orders (
  stripe_session_id TEXT PRIMARY KEY,
  site TEXT NOT NULL,
  printful_store_id TEXT NOT NULL,
  stripe_payment_intent_id TEXT,
  stripe_charge_id TEXT,
  printful_order_id TEXT,
  printful_external_id TEXT,
  customer_email_hash TEXT,
  currency TEXT NOT NULL,
  retail_subtotal_cents INTEGER NOT NULL,
  retail_shipping_cents INTEGER NOT NULL,
  retail_total_cents INTEGER NOT NULL,
  stripe_fee_cents INTEGER,
  stripe_net_cents INTEGER,
  printful_total_cents INTEGER,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  fulfilled_at TEXT,
  raw_stripe_session_json TEXT,
  raw_printful_order_json TEXT
);

CREATE TABLE order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stripe_session_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  product_name TEXT NOT NULL,
  color TEXT NOT NULL,
  size TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  retail_unit_cents INTEGER NOT NULL,
  printful_variant_id INTEGER NOT NULL,
  printful_line_external_id TEXT,
  FOREIGN KEY (stripe_session_id) REFERENCES orders(stripe_session_id)
);

CREATE INDEX order_items_session_idx ON order_items(stripe_session_id);
CREATE INDEX orders_created_at_idx ON orders(created_at);
CREATE INDEX orders_printful_order_id_idx ON orders(printful_order_id);
```

Optional event table:

```sql
CREATE TABLE order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stripe_session_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_event_id TEXT,
  created_at TEXT NOT NULL,
  payload_json TEXT,
  FOREIGN KEY (stripe_session_id) REFERENCES orders(stripe_session_id)
);
```

## Privacy

Store the minimum needed for reconciliation.

Recommended:

- Store Stripe session ID, Printful order ID, product details, quantities, and amounts.
- Store a customer email hash if customer-level matching is useful.
- Avoid storing full shipping addresses in D1.
- Avoid storing raw provider JSON if retention/PII exposure is a concern.

If raw JSON is stored, document the retention policy and ensure it does not expose more customer data than needed.

## Worker Flow

### Checkout Creation

Add stable metadata to the Stripe Checkout Session:

```js
metadata: {
  site: 'hmc',
  printful_store_id: '17828143',
  items: JSON.stringify(items),
}
```

### Webhook Handling

On `checkout.session.completed`:

1. Verify Stripe signature.
2. Use `session.id` as the durable order ID.
3. Insert or upsert `orders`.
4. Insert `order_items`.
5. Create the Printful order with `external_id = session.id`.
6. Confirm the Printful order.
7. Update `orders` with Printful result fields.

The existing KV idempotency check can stay as a fast guard, but D1 should become the durable record. The D1 primary key on `stripe_session_id` should also protect against duplicate inserts.

## Implementation Steps

1. Create D1 database for HMC orders.
2. Add D1 binding to `worker/wrangler.json`.
3. Add SQL migration files under `worker/migrations/`.
4. Add small database helper functions in the Worker.
5. Update checkout metadata.
6. Update Printful order creation to set `external_id`.
7. Write order and item records on webhook.
8. Add tests for:
   - one-item checkout
   - multi-item checkout
   - webhook retry/idempotency
   - Printful success result persisted
   - Printful failure status persisted
9. Document how to query/export ledger data.

## Open Questions

- Should customer email be stored as a hash, raw email, or omitted?
- Should raw Stripe/Printful JSON be stored, or should only selected fields be persisted?
- Should sample/manual Printful orders be imported into the ledger later as non-Stripe orders?
- Should KV idempotency remain after D1 uniqueness is in place?

## Relationship To Roadmap

This design supports the roadmap item "Durable Order Ledger" and builds on "Checkout-to-Fulfillment Reconciliation IDs".
