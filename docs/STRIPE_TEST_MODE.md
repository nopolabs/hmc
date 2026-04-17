Enabling Stripe Test Mode

1. Get your test secret key
- Go to https://dashboard.stripe.com → toggle "Test mode" on (top right)
- Navigate to Developers → API keys
- Copy the Secret key (sk_test_...)

2. Get a test webhook secret
- Still in test mode: Developers → Webhooks
- Click Add endpoint
    - URL: https://hmc-cycling.org/webhook
    - Events: checkout.session.completed
- After saving, click the endpoint → Reveal the signing secret (whsec_...)

3. Update .dev.vars with test secrets
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   PRINTFUL_API_KEY=...

4. Push test secrets and deploy
   cd /Users/danrevel/dev/HMC/worker
   ./deploy-secrets.sh
   npm run deploy

5. Run the test
- Go to https://hmc-cycling.org, pick a size, Buy Now
- Use test card: 4242 4242 4242 4242, any future date, any CVC
- Use a real shipping address (your own, to verify Printful)
- Confirm you land on /success
- Check Printful dashboard for the draft/pending order

---

Disabling Test Mode (going live)

6. Get your live secret key
- Toggle test mode off in Stripe dashboard
- Developers → API keys → copy live sk_live_...

7. Get the live webhook secret
- Developers → Webhooks → Add endpoint (same URL/event as above)
- Reveal and copy the live whsec_...

8. Update .prod.vars with live secrets
   STRIPE_SECRET_KEY=sk_live_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   PRINTFUL_API_KEY=...

9. Push live secrets and deploy
   cd /Users/danrevel/dev/HMC/worker
   ./deploy-secrets.sh .prod.vars
   npm run deploy