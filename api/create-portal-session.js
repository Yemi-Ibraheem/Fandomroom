const { send, requireMethod, requireStripe, requireSupabaseAdmin, authenticatedUser, supabase, stripeRequest } = require('./billing');

module.exports = async (req, res) => {
  if (!requireMethod(req, res, 'POST') || !requireStripe(res) || !requireSupabaseAdmin(res)) return;
  try {
    const user = await authenticatedUser(req);
    if (!user) return send(res, 401, { error: 'Sign in with your Fandom Room account to continue.' });
    const rows = await supabase(`user_subscriptions?${new URLSearchParams({ select: 'stripe_customer_id', user_id: `eq.${user.id}`, limit: '1' })}`);
    const customerId = rows?.[0]?.stripe_customer_id;
    if (!customerId) return send(res, 404, { error: 'No Superfan billing account was found.' });
    const fields = new URLSearchParams({ customer: customerId, return_url: `${process.env.FANDOMROOM_SITE_URL || 'https://www.fandomroom.com'}/#superfan` });
    const session = await stripeRequest('billing_portal/sessions', fields);
    return send(res, 200, { url: session.url });
  } catch (error) {
    return send(res, 500, { error: error.message || 'Could not open membership settings.' });
  }
};
