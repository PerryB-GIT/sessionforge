# Stripe Setup

## Products & Prices to Create

### Free Plan
- Product: "SessionForge Free"
- Price: $0/month
- No Stripe price needed (handled in app)

### Pro Plan  
- Product: "SessionForge Pro"
- Price: $19.00/month recurring
- Price ID: store in env as STRIPE_PRICE_PRO

### Team Plan
- Product: "SessionForge Team"  
- Price: $49.00/month recurring
- Price ID: store in env as STRIPE_PRICE_TEAM

### Enterprise Plan
- Product: "SessionForge Enterprise"
- Price: $199.00/month recurring
- Price ID: store in env as STRIPE_PRICE_ENTERPRISE

## Webhook Events to Handle
- checkout.session.completed
- invoice.paid
- invoice.payment_failed
- customer.subscription.updated
- customer.subscription.deleted

## Webhook Endpoint
- URL: https://sessionforge.dev/api/webhooks/stripe
- Secret: store in STRIPE_WEBHOOK_SECRET

## Setup Steps
1. Create Stripe account (or use existing)
2. Create products and prices in dashboard
3. Copy price IDs to .env
4. Set up webhook endpoint
5. Test with Stripe CLI: stripe listen --forward-to localhost:3000/api/webhooks/stripe
