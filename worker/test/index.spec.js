import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from '../src';
import { PRODUCTS } from '../src/products.js';

// ── Stripe mock ──────────────────────────────────────────────────────────────
// vi.hoisted ensures these are available inside the vi.mock factory (which is
// hoisted above imports at compile time).
const { mockSessionCreate, mockConstructEvent } = vi.hoisted(() => ({
	mockSessionCreate: vi.fn(),
	mockConstructEvent: vi.fn(),
}));

vi.mock('stripe', () => ({
	default: vi.fn().mockImplementation(() => ({
		checkout: { sessions: { create: mockSessionCreate } },
		webhooks: { constructEventAsync: mockConstructEvent },
	})),
}));

beforeEach(() => {
	vi.clearAllMocks();
});

// ── Test data ────────────────────────────────────────────────────────────────
// Pick a real product/color/size from the generated catalog so tests stay
// in sync with whatever products-config.json contains.
const SLUG  = Object.keys(PRODUCTS)[0];
const COLOR = Object.keys(PRODUCTS[SLUG].variants)[0];
const SIZE  = Object.keys(PRODUCTS[SLUG].variants[COLOR])[0];
const VALID_ITEM = { slug: SLUG, color: COLOR, size: SIZE, qty: 1 };

// ── Helpers ──────────────────────────────────────────────────────────────────
async function callWorker(request) {
	const ctx = createExecutionContext();
	const res = await worker.fetch(request, env, ctx);
	await waitOnExecutionContext(ctx);
	return res;
}

function postJson(path, body) {
	return new Request(`https://hmc-cycling.org${path}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
}

function mockWebhookEvent(type, sessionOverrides = {}) {
	return {
		type,
		data: {
			object: {
				id: 'cs_test_idempotency_key',
				metadata: { items: JSON.stringify([VALID_ITEM]) },
				collected_information: {
					shipping_details: {
						name: 'Test User',
						address: { line1: '1 Main St', line2: null, city: 'Portland', state: 'OR', country: 'US', postal_code: '97201' },
					},
				},
				customer_details: { email: 'test@example.com' },
				...sessionOverrides,
			},
		},
	};
}

// ── Routing ──────────────────────────────────────────────────────────────────
describe('routing', () => {
	it('returns 404 for unknown paths', async () => {
		const res = await callWorker(new Request('https://hmc-cycling.org/unknown'));
		expect(res.status).toBe(404);
	});

	it('returns 404 for GET /checkout', async () => {
		const res = await callWorker(new Request('https://hmc-cycling.org/checkout'));
		expect(res.status).toBe(404);
	});
});

// ── POST /checkout -validation ───────────────────────────────────────────────
describe('POST /checkout -validation', () => {
	it('returns 400 for non-JSON body', async () => {
		const req = new Request('https://hmc-cycling.org/checkout', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: 'not json',
		});
		const res = await callWorker(req);
		expect(res.status).toBe(400);
	});

	it('returns 400 for empty items array', async () => {
		const res = await callWorker(postJson('/checkout', { items: [] }));
		expect(res.status).toBe(400);
	});

	it('returns 400 when color is missing', async () => {
		const { color: _omit, ...itemNoColor } = VALID_ITEM;
		const res = await callWorker(postJson('/checkout', { items: [itemNoColor] }));
		expect(res.status).toBe(400);
	});

	it('returns 400 for unknown product slug', async () => {
		const res = await callWorker(postJson('/checkout', {
			items: [{ slug: 'no-such-product', color: COLOR, size: SIZE, qty: 1 }],
		}));
		expect(res.status).toBe(400);
	});

	it('returns 400 for unknown color', async () => {
		const res = await callWorker(postJson('/checkout', {
			items: [{ ...VALID_ITEM, color: 'Invisible' }],
		}));
		expect(res.status).toBe(400);
	});

	it('returns 400 for unknown size', async () => {
		const res = await callWorker(postJson('/checkout', {
			items: [{ ...VALID_ITEM, size: 'XXXL' }],
		}));
		expect(res.status).toBe(400);
	});
});

// ── POST /checkout -happy path ───────────────────────────────────────────────
describe('POST /checkout -happy path', () => {
	it('creates a Stripe session and returns the URL', async () => {
		mockSessionCreate.mockResolvedValueOnce({ url: 'https://checkout.stripe.com/pay/test_abc' });

		const res = await callWorker(postJson('/checkout', { items: [VALID_ITEM] }));

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.url).toBe('https://checkout.stripe.com/pay/test_abc');
	});

	it('passes the flat per-product price to Stripe (not Printful variant price)', async () => {
		mockSessionCreate.mockResolvedValueOnce({ url: 'https://checkout.stripe.com/pay/test_abc' });

		await callWorker(postJson('/checkout', { items: [VALID_ITEM] }));

		const call = mockSessionCreate.mock.calls[0][0];
		expect(call.line_items[0].price_data.unit_amount).toBe(PRODUCTS[SLUG].price);
	});

	it('includes color and size in the Stripe line item name', async () => {
		mockSessionCreate.mockResolvedValueOnce({ url: 'https://checkout.stripe.com/pay/test_abc' });

		await callWorker(postJson('/checkout', { items: [VALID_ITEM] }));

		const call = mockSessionCreate.mock.calls[0][0];
		const name = call.line_items[0].price_data.product_data.name;
		expect(name).toContain(COLOR);
		expect(name).toContain(SIZE);
	});

	it('sums quantities correctly for shipping calculation', async () => {
		mockSessionCreate.mockResolvedValueOnce({ url: 'https://checkout.stripe.com/pay/test_abc' });

		await callWorker(postJson('/checkout', { items: [{ ...VALID_ITEM, qty: 3 }] }));

		const call = mockSessionCreate.mock.calls[0][0];
		expect(call.line_items[0].quantity).toBe(3);
	});
});

// ── POST /webhook ─────────────────────────────────────────────────────────────
describe('POST /webhook', () => {
	it('returns 400 for invalid Stripe signature', async () => {
		mockConstructEvent.mockRejectedValueOnce(new Error('No signatures found'));

		const req = new Request('https://hmc-cycling.org/webhook', {
			method: 'POST',
			headers: { 'stripe-signature': 'bad_sig' },
			body: '{}',
		});
		const res = await callWorker(req);
		expect(res.status).toBe(400);
	});

	it('returns 200 and ignores non-checkout events', async () => {
		mockConstructEvent.mockResolvedValueOnce(mockWebhookEvent('payment_intent.created'));

		const req = new Request('https://hmc-cycling.org/webhook', {
			method: 'POST',
			headers: { 'stripe-signature': 'sig' },
			body: '{}',
		});
		const res = await callWorker(req);
		expect(res.status).toBe(200);
	});

	it('returns 200 and skips order creation for already-processed sessions', async () => {
		const sessionId = 'cs_test_already_done';
		await env.ORDERS.put(sessionId, 'processed');

		mockConstructEvent.mockResolvedValueOnce(
			mockWebhookEvent('checkout.session.completed', { id: sessionId })
		);

		const req = new Request('https://hmc-cycling.org/webhook', {
			method: 'POST',
			headers: { 'stripe-signature': 'sig' },
			body: '{}',
		});
		const res = await callWorker(req);
		expect(res.status).toBe(200);
	});
});
