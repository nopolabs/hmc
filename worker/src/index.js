import Stripe from 'stripe';
import { PRODUCTS } from './products.js';

const PRINTFUL_STORE_ID = 17828143;

export default {
	async fetch(request, env, ctx) {
		const url = new URL(request.url);

		if (url.pathname === '/checkout') {
			if (request.method === 'POST') return handleCartCheckout(request, env);
			if (request.method === 'GET') return handleCheckout(request, env, url);
		}

		if (request.method === 'POST' && url.pathname === '/webhook') {
			return handleWebhook(request, env, ctx);
		}

		return new Response('Not found', { status: 404 });
	}
};

function shippingOption(totalItems) {
	const amount = 475 + Math.max(0, totalItems - 1) * 220;
	return {
		shipping_rate_data: {
			type: 'fixed_amount',
			fixed_amount: { amount, currency: 'usd' },
			display_name: 'Standard Shipping',
			delivery_estimate: {
				minimum: { unit: 'business_day', value: 5 },
				maximum: { unit: 'business_day', value: 10 },
			},
		},
	};
}

async function handleCartCheckout(request, env) {
	let body;
	try {
		body = await request.json();
	} catch {
		return new Response('Invalid JSON', { status: 400 });
	}

	const { items } = body;
	if (!Array.isArray(items) || items.length === 0) {
		return new Response('Cart is empty', { status: 400 });
	}

	const lineItems = [];
	for (const item of items) {
		const productDef = PRODUCTS[item.slug];
		if (!productDef) return new Response(`Product not found: ${item.slug}`, { status: 400 });
		const variant = productDef.variants[item.size];
		if (!variant) return new Response(`Size not found: ${item.size}`, { status: 400 });
		lineItems.push({
			price_data: {
				currency: 'usd',
				product_data: { name: `${productDef.name} (${item.size})` },
				unit_amount: variant.price,
			},
			quantity: item.qty || 1,
		});
	}

	const totalItems = items.reduce((s, i) => s + (i.qty || 1), 0);
	const stripe = new Stripe(env.STRIPE_SECRET_KEY);
	const session = await stripe.checkout.sessions.create({
		payment_method_types: ['card'],
		line_items: lineItems,
		mode: 'payment',
		shipping_address_collection: { allowed_countries: ['US'] },
		shipping_options: [shippingOption(totalItems)],
		metadata: { items: JSON.stringify(items) },
		success_url: 'https://hmc-cycling.org/success',
		cancel_url: 'https://hmc-cycling.org/',
	});

	return new Response(JSON.stringify({ url: session.url }), {
		headers: { 'Content-Type': 'application/json' },
	});
}

// Legacy single-item GET endpoint
async function handleCheckout(request, env, url) {
	const slug = url.searchParams.get('slug');
	const size = url.searchParams.get('size');
	const productDef = PRODUCTS[slug];

	if (!productDef) {
		return new Response('Product not found', { status: 404 });
	}

	const variant = productDef.variants[size];
	if (!variant) {
		return new Response('Size not found', { status: 404 });
	}

	const stripe = new Stripe(env.STRIPE_SECRET_KEY);

	const session = await stripe.checkout.sessions.create({
		payment_method_types: ['card'],
		line_items: [{
			price_data: {
				currency: 'usd',
				product_data: { name: `${productDef.name} (${size})` },
				unit_amount: variant.price,
			},
			quantity: 1,
		}],
		mode: 'payment',
		shipping_address_collection: { allowed_countries: ['US'] },
		shipping_options: [shippingOption(1)],
		metadata: { items: JSON.stringify([{ slug, size, qty: 1 }]) },
		success_url: 'https://hmc-cycling.org/success',
		cancel_url: 'https://hmc-cycling.org/',
	});

	return Response.redirect(session.url, 303);
}

async function handleWebhook(request, env, ctx) {
	const signature = request.headers.get('stripe-signature');
	const body = await request.text();

	let event;
	try {
		const stripe = new Stripe(env.STRIPE_SECRET_KEY);
		event = await stripe.webhooks.constructEventAsync(
			body,
			signature,
			env.STRIPE_WEBHOOK_SECRET
		);
	} catch (err) {
		return new Response(`Webhook signature verification failed: ${err.message}`, { status: 400 });
	}

	if (event.type === 'checkout.session.completed') {
		const session = event.data.object;
		const sessionId = session.id;

		// idempotency check
		const already_processed = await env.ORDERS.get(sessionId);
		if (already_processed) {
			console.log('Already processed session:', sessionId);
			return new Response('OK', { status: 200 });
		}

		// mark as processed before creating order to prevent races
		await env.ORDERS.put(sessionId, 'processed', { expirationTtl: 86400 * 30 });

		ctx.waitUntil(createPrintfulOrder(session, env));
	}

	return new Response('OK', { status: 200 });
}

async function createPrintfulOrder(session, env) {
	const cartItems = JSON.parse(session.metadata.items);
	const shipping = session.collected_information.shipping_details;

	let subtotal = 0;
	const printfulItems = cartItems.map(item => {
		const variant = PRODUCTS[item.slug].variants[item.size];
		const lineTotal = (variant.price / 100) * item.qty;
		subtotal += lineTotal;
		return {
			sync_variant_id: variant.printful_variant_id,
			quantity: item.qty,
			retail_price: (variant.price / 100).toFixed(2),
		};
	});

	const order = {
		recipient: {
			name: shipping.name,
			address1: shipping.address.line1,
			address2: shipping.address.line2 || '',
			city: shipping.address.city,
			state_code: shipping.address.state,
			country_code: shipping.address.country,
			zip: shipping.address.postal_code,
			email: session.customer_details.email,
		},
		items: printfulItems,
		retail_costs: {
			currency: 'USD',
			subtotal: subtotal.toFixed(2),
		}
	};

	const response = await fetch(
		`https://api.printful.com/orders?store_id=${PRINTFUL_STORE_ID}`,
		{
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${env.PRINTFUL_API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(order),
		}
	);

	const result = await response.json();
	console.log('Printful order result:', JSON.stringify(result, null, 2));

	const orderId = result.result.id;
	const confirmResponse = await fetch(
		`https://api.printful.com/orders/${orderId}/confirm?store_id=${PRINTFUL_STORE_ID}`,
		{
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${env.PRINTFUL_API_KEY}`,
				'Content-Type': 'application/json',
			},
		}
	);
	const confirmResult = await confirmResponse.json();
	console.log('Printful confirm result:', confirmResult.result.status);

	return result;
}
