import { createHmac, timingSafeEqual } from 'node:crypto';

const MAX_BODY_BYTES = 1024 * 1024;
const SIGNATURE_TOLERANCE_SECONDS = 300;
const PREMIUM_STATUSES = new Set(['active', 'trialing']);

function verifySignature(rawBody, header, secret) {
  if (!header) return false;

  const parts = header.split(',').map(part => part.trim().split('='));
  const timestamp = Number(parts.find(([key]) => key === 't')?.[1]);
  const signatures = parts.filter(([key]) => key === 'v1').map(([, value]) => value);
  if (!Number.isInteger(timestamp) || !signatures.length) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > SIGNATURE_TOLERANCE_SECONDS) return false;

  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest();

  return signatures.some(signature => {
    if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
    const supplied = Buffer.from(signature, 'hex');
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  });
}

async function stripeGet(path, secretKey) {
  const response = await fetch(`https://api.stripe.com${path}`, {
    headers: { Authorization: `Bearer ${secretKey}` }
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Stripe API returned ${response.status}.`);
  return response.json();
}

async function getAuthUser(userId, supabaseUrl, serviceRoleKey) {
  const response = await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` }
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Supabase Auth returned ${response.status}.`);
  return response.json();
}

async function savePremiumStatus(userId, subscription, supabaseUrl, serviceRoleKey) {
  if (!userId || !subscription?.id || !subscription?.status) return;

  const user = await getAuthUser(userId, supabaseUrl, serviceRoleKey);
  if (!user?.id) return;

  const appMetadata = { ...(user.app_metadata || {}) };
  const currentSubscriptionId = appMetadata.stripe_subscription_id;
  const isPremium = PREMIUM_STATUSES.has(subscription.status);

  // An older subscription's delayed cancellation event must not revoke access
  // granted by a newer subscription.
  if (!isPremium && currentSubscriptionId && currentSubscriptionId !== subscription.id) return;

  appMetadata.stripe_customer_id = typeof subscription.customer === 'string'
    ? subscription.customer
    : subscription.customer?.id || appMetadata.stripe_customer_id;
  appMetadata.stripe_subscription_id = subscription.id;
  appMetadata.stripe_subscription_status = subscription.status;
  if (isPremium) appMetadata.plan = 'premium';
  else delete appMetadata.plan;

  const response = await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PUT',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ app_metadata: appMetadata })
  });
  if (!response.ok) throw new Error(`Supabase Auth update returned ${response.status}.`);
}

async function handleEvent(event, env) {
  const eventObject = event.data?.object;

  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    if (eventObject?.mode !== 'subscription') return;
    const userId = eventObject.client_reference_id || eventObject.metadata?.supabase_user_id;
    const subscriptionId = typeof eventObject.subscription === 'string'
      ? eventObject.subscription
      : eventObject.subscription?.id;
    if (!userId || !subscriptionId) return;

    const subscription = await stripeGet(`/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, env.stripeSecretKey);
    if (subscription) await savePremiumStatus(userId, subscription, env.supabaseUrl, env.serviceRoleKey);
    return;
  }

  if (event.type.startsWith('customer.subscription.') && eventObject?.id) {
    const userId = eventObject.metadata?.supabase_user_id;
    if (!userId) {
      console.warn('Stripe subscription event has no Supabase user reference.');
      return;
    }

    // Read the current subscription so a delayed event cannot overwrite a newer status.
    const latest = await stripeGet(`/v1/subscriptions/${encodeURIComponent(eventObject.id)}`, env.stripeSecretKey);
    await savePremiumStatus(userId, latest || eventObject, env.supabaseUrl, env.serviceRoleKey);
  }
}

export async function POST(request) {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const signingSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!stripeSecretKey || !signingSecret || !supabaseUrl || !serviceRoleKey) {
    console.error('Stripe webhook environment is incomplete.');
    return new Response('Webhook is not configured.', { status: 500 });
  }

  const rawBody = Buffer.from(await request.arrayBuffer());
  if (rawBody.length > MAX_BODY_BYTES) return new Response('Request body is too large.', { status: 413 });
  if (!verifySignature(rawBody, request.headers.get('stripe-signature'), signingSecret)) {
    return new Response('Invalid Stripe signature.', { status: 400 });
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return new Response('Invalid event payload.', { status: 400 });
  }

  try {
    await handleEvent(event, { stripeSecretKey, supabaseUrl, serviceRoleKey });
    return Response.json({ received: true });
  } catch (error) {
    console.error('Stripe webhook processing failed:', error.message);
    return new Response('Webhook processing failed.', { status: 500 });
  }
}

export function GET() {
  return new Response('Method not allowed.', { status: 405, headers: { Allow: 'POST' } });
}
