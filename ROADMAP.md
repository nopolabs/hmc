# Roadmap

Future improvements for HMC-Cycling.org.

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
