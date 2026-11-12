# Stripe Premium setup status

## Implemented

- `api/create-checkout-session.js` verifies the signed-in Supabase user, creates a Stripe subscription Checkout Session, and associates the session and subscription with that user.
- `api/stripe-webhook.mjs` verifies Stripe's signature against the raw request body and updates Supabase Auth `app_metadata.plan` to `premium` only for active or trialing subscriptions. Subscription cancellation removes the Premium flag.
- `website.js` sends signed-in users to Stripe Checkout when they choose Subscribe to Premium.

## Production configuration

Set these variables for the Vercel **Production** environment, then redeploy:

| Variable | Purpose |
| --- | --- |
| `STRIPE_SECRET_KEY` | Live Stripe API access for Checkout and subscription lookups |
| `STRIPE_PREMIUM_PRICE_ID` or `STRIPE_PRICE_MONTHLY` | Recurring Premium Price ID (`price_...`); the dedicated Premium variable takes precedence |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for the live `Fandomroom production` webhook destination |
| `SUPABASE_URL` | Supabase project URL, not a publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only key used to update Supabase Auth user metadata |

The Stripe production destination should point to `https://www.fandomroom.com/api/stripe-webhook` and listen for:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

## Verification

- Unsigned POST requests should receive HTTP 400.
- Stripe-signed subscription events should receive HTTP 200 and update the matching Supabase user's `app_metadata`.
- A cancelled subscription should no longer have `app_metadata.plan = "premium"`.
- Check Stripe's Event deliveries after a real event or a safe dashboard test event. A live paid checkout is not required just to confirm the endpoint is reachable.

The local handler checks passed for unsigned rejection, signed activation, and signed cancellation. Production behavior still requires deploying these files and confirming a delivery in Stripe.
