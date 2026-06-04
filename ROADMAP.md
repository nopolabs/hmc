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

## Checkout-to-Fulfillment Reconciliation IDs

Priority: high for financial reconciliation.

Current state:

- Stripe Checkout Sessions store only `metadata.items`.
- Printful orders are created without `external_id`.
- Printful line items are created without line-level external IDs.
- Historical Stripe-to-Printful reconciliation therefore requires matching by customer, date, product variants, quantities, and amounts.

Target state:

- Add explicit HMC site metadata to Stripe Checkout Sessions.
- Propagate the Stripe Checkout Session ID into the Printful order `external_id`.
- Add stable external IDs to Printful line items.
- Include customer shipping revenue in Printful `retail_costs.shipping` if available at fulfillment time.

Suggested implementation:

```js
const session = await stripe.checkout.sessions.create({
  // ...
  metadata: {
    site: 'hmc',
    printful_store_id: '17828143',
    items: JSON.stringify(items),
  },
});
```

```js
const order = {
  external_id: session.id,
  // ...
  items: printfulItems.map((item, index) => ({
    ...item,
    external_id: `${session.id}-${index + 1}`,
  })),
};
```

Expected benefit:

- Future reconciliation can match Stripe and Printful records by exact ID instead of fuzzy matching.
- Shared Stripe and Printful accounts can distinguish HMC transactions from other sites using explicit metadata.
- Exceptions reports shrink to genuine operational anomalies.

Acceptance criteria:

- New Stripe Checkout Sessions include `metadata.site = hmc`.
- New Stripe Checkout Sessions include `metadata.printful_store_id = 17828143`.
- New Printful orders use the Stripe Checkout Session ID as `external_id`.
- New Printful line items include deterministic external IDs derived from the Stripe Checkout Session ID.
- Webhook retries remain idempotent through the existing KV session ID check.
- Existing successful checkout and Printful fulfillment behavior is unchanged.
