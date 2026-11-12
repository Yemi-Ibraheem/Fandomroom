require('../supabase/config.js');
const { randomInt } = require('crypto');
const { url: supabaseUrl, publishableKey } = globalThis.FANDOMROOM_SUPABASE || {};

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.statusCode = 405; res.setHeader('Allow', 'POST'); res.end('Method not allowed.'); return; }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const priceId = process.env.STRIPE_PREMIUM_PRICE_ID || process.env.STRIPE_PRICE_MONTHLY;
  if (!secretKey) { res.statusCode = 503; res.end('Stripe Checkout is not configured.'); return; }
  if (!priceId) { res.statusCode = 503; res.end('Premium pricing is not configured.'); return; }
  if (!supabaseUrl || !publishableKey) { res.statusCode = 503; res.end('Fandom Room authentication is not configured.'); return; }

  const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) { res.statusCode = 401; res.end('Sign in before starting checkout.'); return; }

  let user;
  try {
    const authResponse = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/user`, {
      headers: { apikey: publishableKey, Authorization: `Bearer ${token}` }
    });
    if (!authResponse.ok) { res.statusCode = 401; res.end('Your sign-in session is invalid or expired.'); return; }
    user = await authResponse.json();
    if (!user.id) { res.statusCode = 401; res.end('Your sign-in session is invalid or expired.'); return; }
  } catch (error) {
    console.error('Could not verify the Fandom Room checkout user:', error);
    res.statusCode = 502; res.end('Could not verify your Fandom Room account.'); return;
  }

  const params = new URLSearchParams({
    ui_mode: 'hosted_page',
    mode: 'subscription',
    billing_address_collection: 'auto',
    'phone_number_collection[enabled]': 'false',
    'automatic_tax[enabled]': 'false',
    allow_promotion_codes: 'false',
    payment_method_collection: 'always',
    submit_type: 'auto',
    integration_identifier: `hosted_web_${Array.from({ length: 8 }, () => 'abcdefghijklmnopqrstuvwxyz'[randomInt(26)]).join('')}`,
    origin_context: 'web',
    client_reference_id: user.id,
    'metadata[supabase_user_id]': user.id,
    'subscription_data[metadata][supabase_user_id]': user.id,
    success_url: 'https://www.fandomroom.com/?checkout=success&session_id={CHECKOUT_SESSION_ID}',
    cancel_url: 'https://www.fandomroom.com/?checkout=cancelled',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1'
  });

  try {
    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    });
    const session = await response.json();
    if (!response.ok || !session.url) {
      console.error('Stripe rejected a Checkout Session:', response.status, session.error?.message || 'No checkout URL returned.');
      res.statusCode = 502; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: 'Could not start Stripe Checkout.' })); return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200; res.end(JSON.stringify({ url: session.url }));
  } catch (error) {
    console.error('Could not create a Stripe Checkout Session:', error);
    res.statusCode = 502; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: 'Could not reach Stripe Checkout.' }));
  }
};
