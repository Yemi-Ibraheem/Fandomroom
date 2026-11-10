const crypto = require('node:crypto');
const { send, requireMethod, requireStripe, requireSupabaseAdmin, authenticatedUser, supabase, stripeRequest, siteUrl } = require('./billing');

module.exports = async (req, res) => {
  if (!requireMethod(req, res, 'POST') || !requireStripe(res) || !requireSupabaseAdmin(res)) return;
  try {
    const user = await authenticatedUser(req);
    if (!user) return send(res, 401, { error: 'Sign in with your Fandom Room account to continue.' });
    const plan = req.body?.plan;
    const price = plan === 'monthly' ? process.env.STRIPE_PRICE_MONTHLY : plan === 'yearly' ? process.env.STRIPE_PRICE_YEARLY : '';
    if (!price) return send(res, 503, { error: 'That Superfan plan is not configured yet.' });

    const existing = await supabase(`user_subscriptions?${new URLSearchParams({ select: 'status', user_id: `eq.${user.id}`, limit: '1' })}`);
    if (existing?.some(row => row.status === 'active' || row.status === 'trialing')) {
      return send(res, 409, { error: 'Your Superfan membership is already active. Use Manage membership instead.' });
    }

    const fields = new URLSearchParams();
    fields.set('mode', 'subscription');
    fields.set('line_items[0][price]', price);
    fields.set('line_items[0][quantity]', '1');
    fields.set('customer_email', user.email || '');
    fields.set('client_reference_id', user.id);
    fields.set('metadata[supabase_user_id]', user.id);
    fields.set('subscription_data[metadata][supabase_user_id]', user.id);
    fields.set('subscription_data[metadata][fandomroom_plan]', plan);
    fields.set('success_url', `${siteUrl}/?superfan=success&session_id={CHECKOUT_SESSION_ID}#superfan`);
    fields.set('cancel_url', `${siteUrl}/?superfan=cancelled#superfan`);
    const session = await stripeRequest('checkout/sessions', fields, `superfan-${user.id}-${plan}-${crypto.randomUUID()}`);
    return send(res, 200, { url: session.url });
  } catch (error) {
    return send(res, 500, { error: error.message || 'Could not start Superfan checkout.' });
  }
};
