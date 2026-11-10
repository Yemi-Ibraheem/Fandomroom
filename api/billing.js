const publicConfig = (() => {
  try { require('../supabase/config.js'); return globalThis.FANDOMROOM_SUPABASE || {}; }
  catch { return {}; }
})();

const supabaseUrl = (process.env.SUPABASE_URL || publicConfig.url || '').replace(/\/$/, '');
const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY || publicConfig.publishableKey || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const stripeKey = process.env.STRIPE_SECRET_KEY || '';
const siteUrl = (process.env.FANDOMROOM_SITE_URL || 'https://www.fandomroom.com').replace(/\/$/, '');

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function requireMethod(req, res, method) {
  if (req.method === method) return true;
  res.setHeader('Allow', method);
  send(res, 405, { error: 'Method not allowed.' });
  return false;
}

function requireStripe(res) {
  if (stripeKey) return true;
  send(res, 503, { error: 'Superfan checkout is being configured.' });
  return false;
}

function requireSupabaseAdmin(res) {
  if (supabaseUrl && supabaseKey && serviceKey) return true;
  send(res, 503, { error: 'Superfan membership storage is being configured.' });
  return false;
}

async function supabase(path, options = {}) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.message || body?.details || 'Could not read membership data.');
  return body;
}

async function authenticatedUser(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token || !supabaseUrl || !supabaseKey) return null;
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: supabaseKey, Authorization: `Bearer ${token}` }
  });
  if (!response.ok) return null;
  const user = await response.json().catch(() => null);
  return user?.id && !user.is_anonymous ? user : null;
}

async function stripeRequest(path, fields, idempotencyKey = '') {
  const headers = { Authorization: `Bearer ${stripeKey}`, 'Content-Type': 'application/x-www-form-urlencoded' };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const response = await fetch(`https://api.stripe.com/v1/${path}`, { method: 'POST', headers, body: fields.toString() });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error?.message || 'Stripe could not complete the request.');
  return result;
}

module.exports = { send, requireMethod, requireStripe, requireSupabaseAdmin, supabase, authenticatedUser, stripeRequest, stripeKey, supabaseUrl, supabaseKey, serviceKey, siteUrl };
