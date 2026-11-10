const crypto = require('node:crypto');
const { send, requireMethod, requireSupabaseAdmin, supabase, stripeKey, siteUrl } = require('./billing');

async function readRawBody(req) {
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody;
  if (typeof req.rawBody === 'string') return Buffer.from(req.rawBody);
  if (Buffer.isBuffer(req.body)) return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function verifyStripeSignature(rawBody, header, secret) {
  const parts = String(header || '').split(',').map(part => part.split('='));
  const timestamp = parts.find(([key]) => key === 't')?.[1];
  const signatures = parts.filter(([key]) => key === 'v1').map(([, value]) => value);
  if (!timestamp || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest();
  return signatures.some(value => {
    if (!/^[a-f0-9]{64}$/i.test(value || '')) return false;
    const actual = Buffer.from(value, 'hex');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  });
}

async function stripeGet(path) {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, { headers: { Authorization: `Bearer ${stripeKey}` } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error?.message || 'Could not retrieve the Stripe subscription.');
  return result;
}

async function saveSubscription(subscription, userId = '') {
  const ownerId = userId || subscription.metadata?.supabase_user_id;
  if (!ownerId) {
    const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id;
    if (!customerId) return;
    const rows = await supabase(`user_subscriptions?${new URLSearchParams({ select: 'user_id', stripe_customer_id: `eq.${customerId}`, limit: '1' })}`);
    if (!rows?.[0]?.user_id) return;
    return saveSubscription(subscription, rows[0].user_id);
  }
  const priceId = subscription.items?.data?.[0]?.price?.id || null;
  const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id;
  const row = {
    user_id: ownerId,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    status: subscription.status,
    price_id: priceId,
    current_period_end: (subscription.current_period_end || subscription.items?.data?.[0]?.current_period_end)
      ? new Date((subscription.current_period_end || subscription.items.data[0].current_period_end) * 1000).toISOString()
      : null,
    cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
    updated_at: new Date().toISOString()
  };
  await supabase(`user_subscriptions?on_conflict=user_id`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(row)
  });
}

module.exports = async (req, res) => {
  if (!requireMethod(req, res, 'POST') || !requireSupabaseAdmin(res)) return;
  const signingSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripeKey || !signingSecret) return send(res, 503, { error: 'Stripe webhook is not configured.' });
  try {
    const rawBody = await readRawBody(req);
    if (!verifyStripeSignature(rawBody, req.headers['stripe-signature'], signingSecret)) return send(res, 400, { error: 'Invalid Stripe signature.' });
    const event = JSON.parse(rawBody.toString('utf8'));
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const checkout = event.data.object;
      if (checkout.mode === 'subscription' && checkout.subscription) {
        const subscription = await stripeGet(`subscriptions/${encodeURIComponent(checkout.subscription)}`);
        await saveSubscription(subscription, checkout.client_reference_id || checkout.metadata?.supabase_user_id || '');
      }
    } else if (event.type?.startsWith('customer.subscription.')) {
      await saveSubscription(event.data.object);
    }
    return send(res, 200, { received: true });
  } catch (error) {
    return send(res, 500, { error: error.message || 'Could not process the Stripe event.' });
  }
};

module.exports.config = { api: { bodyParser: false } };
