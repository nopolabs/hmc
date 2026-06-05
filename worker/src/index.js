import Stripe from 'stripe';
import { PRODUCTS } from './products.js';
import SHIPPING from '../../src/_data/shipping.json';

const PRINTFUL_STORE_ID = 17828143;

export default {
	async fetch(request, env, ctx) {
		const url = new URL(request.url);

		if (url.pathname === '/checkout') {
			if (request.method === 'POST') return handleCartCheckout(request, env);
		}

		if (request.method === 'POST' && url.pathname === '/webhook') {
			return handleWebhook(request, env, ctx);
		}

		return new Response('Not found', { status: 404 });
	}
};

function shippingOption(totalItems) {
	const amount = SHIPPING.base_rate + Math.max(0, totalItems - 1) * SHIPPING.per_additional_item;
	return {
		shipping_rate_data: {
			type: 'fixed_amount',
			fixed_amount: { amount, currency: 'usd' },
			display_name: SHIPPING.display_name,
			delivery_estimate: {
				minimum: SHIPPING.delivery_estimate.minimum,
				maximum: SHIPPING.delivery_estimate.maximum,
			},
		},
	};
}

function lookupVariant(item) {
	const productDef = PRODUCTS[item.slug];
	if (!productDef) return { error: `Product not found: ${item.slug}` };
	const colorVariants = productDef.variants[item.color];
	if (!colorVariants) return { error: `Color not found: ${item.color} for product ${item.slug}` };
	const variant = colorVariants[item.size];
	if (!variant) return { error: `Size not found: ${item.size} for ${item.color}` };
	return { productDef, variant };
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
		if (!item.color) return new Response(`Missing color for item: ${item.slug}`, { status: 400 });
		const { productDef, variant, error } = lookupVariant(item);
		if (error) return new Response(error, { status: 400 });
		lineItems.push({
			price_data: {
				currency: 'usd',
				product_data: { name: `${productDef.name} — ${item.color} / ${item.size}` },
				unit_amount: productDef.price,
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
		metadata: {
			site: 'hmc',
			printful_store_id: String(PRINTFUL_STORE_ID),
			items: JSON.stringify(items),
		},
		success_url: 'https://hmc-cycling.org/success',
		cancel_url: 'https://hmc-cycling.org/',
	});

	return new Response(JSON.stringify({ url: session.url }), {
		headers: { 'Content-Type': 'application/json' },
	});
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
	const shipping  = session.collected_information.shipping_details;

	let subtotal = 0;
	const printfulItems = cartItems.map((item, index) => {
		const { productDef, variant } = lookupVariant(item);
		const lineTotal = (productDef.price / 100) * item.qty;
		subtotal += lineTotal;
		return {
			external_id:     `${session.id}-${index + 1}`,
			sync_variant_id: variant.printful_variant_id,
			quantity:        item.qty,
			retail_price:    (productDef.price / 100).toFixed(2),
		};
	});

	const order = {
		external_id: session.id,
		recipient: {
			name:         shipping.name,
			address1:     shipping.address.line1,
			address2:     shipping.address.line2 || '',
			city:         shipping.address.city,
			state_code:   shipping.address.state,
			country_code: shipping.address.country,
			zip:          shipping.address.postal_code,
			email:        session.customer_details.email,
		},
		items: printfulItems,
		retail_costs: {
			currency: 'USD',
			subtotal: subtotal.toFixed(2),
			...(session.total_details?.amount_shipping
				? { shipping: (session.total_details.amount_shipping / 100).toFixed(2) }
				: {}),
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