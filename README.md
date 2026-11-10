# Fandom Room

Fandom Room is the public discussion site at https://www.fandomroom.com, with a Manifest V3 Chrome extension companion.

## Load the unpacked extension

1. Open `chrome://extensions` in Chrome and turn on **Developer mode**.
2. If Fandom Room is already listed, click its **Reload** button. Otherwise, click **Load unpacked** and choose this project folder.
3. Open the viewing page you want to discuss.
4. Click the Fandom Room toolbar icon to scan the active tab and open its title or episode discussion.

Fandom Room can scan HTTP and HTTPS viewing pages across sites. **Refresh & scan** rereads the current tab while Chrome allows access. **Edit title or episode** lets you correct a match or enter details the page does not expose. Discussions use the title, season, and episode to find a room. The first comment is saved to that room.

## Publish the website

Vercel serves the static website from `index.html`, including the Fandom Room poll and ranking discussion experience. The project uses the `fandomroom.com` and `www.fandomroom.com` production domains. Vercel production deploys from the repository's `main` branch.

## Connect Supabase

The website and discussion panel use the Supabase project `zbayifekoqasimvqreav` for accounts, polls, rankings, images, replies, and the extension's anime discussions. To finish enabling it:

1. In the Supabase Dashboard for that project, enable **Anonymous Sign-Ins** under Authentication settings.
2. Run [`supabase/migrations/202611040001_talkanime_discussions.sql`](supabase/migrations/202611040001_talkanime_discussions.sql), [`supabase/migrations/202611080001_fandomroom_threads.sql`](supabase/migrations/202611080001_fandomroom_threads.sql), and [`supabase/migrations/202611100001_email_notifications.sql`](supabase/migrations/202611100001_email_notifications.sql) in the SQL Editor, in that order.
3. Copy the project's **publishable key** (or legacy `anon` key) into `publishableKey` in [`supabase/config.js`](supabase/config.js). This key is intended to be public; never use a `service_role` or secret key in the extension.
4. Reload Fandom Room from `chrome://extensions` and refresh the viewing tab.

The extension creates an anonymous Supabase identity and keeps its session in the extension's local browser storage. Anonymous identities are not recoverable on another device or after browser data is cleared. If the publishable key is absent, the extension remains in its local demo mode.

## Enable Google sign-in

1. In Google Cloud, create a **Web application** OAuth client. Add `https://www.fandomroom.com` as an authorized JavaScript origin. Add the Supabase callback URI shown on the Supabase Authentication → Sign In / Providers → Google page as an authorized redirect URI (it has the form `https://<project-ref>.supabase.co/auth/v1/callback`).
2. Copy the Google client ID and secret into that Google provider page in Supabase and enable Google.
3. In Supabase Authentication → URL Configuration, set the Site URL to `https://www.fandomroom.com` and allow `https://www.fandomroom.com/**` as a redirect URL. Add the apex domain too if you want to accept redirects there.
4. Save the provider settings. The website's **Continue with Google** button uses the Supabase OAuth flow and returns to the page where sign-in started.

Keep the Google client secret in Supabase only. Do not add it to Vercel or the repository; only the Supabase publishable key is public.

## Enable Superfan with Stripe

Superfan is priced at **£4.99/month** or **£39.99/year**. Members can rate episodes in the extension and create polls and rankings on the website. Checkout uses Stripe-hosted Checkout; subscription state is written to Supabase by the Stripe webhook and enforced by database policies and RPCs.

1. The `Fandom Room Superfan` product and its £4.99/month and £39.99/year recurring prices are already created in the Stripe sandbox. Copy the two test Price IDs from the product’s Pricing section; create matching prices later in live mode before launch.
2. Add a webhook endpoint at `https://www.fandomroom.com/api/stripe-webhook`. Subscribe it to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, and all `customer.subscription.*` events. Copy the endpoint signing secret.
3. Add the variables in `.env.example` to the Fandomroom Vercel project. Use Stripe **test** secret and webhook keys first, the two Stripe Price IDs, the Supabase project URL and the Supabase **service_role** key. Set them as sensitive/server-only variables for Preview and Development; keep Production values separate until test checkout is verified.
4. Run [`supabase/migrations/202611100001_superfan.sql`](supabase/migrations/202611100001_superfan.sql) in the Supabase SQL Editor after the existing migrations.
5. Redeploy the Vercel project so the API functions receive the new variables. Verify checkout, cancellation, the extension sign-in, and the server-side membership gates before switching Stripe to live mode.

Never put `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, or `SUPABASE_SERVICE_ROLE_KEY` in `supabase/config.js`, the extension, or a committed environment file. The `.env.example` file contains names only.

## Enable email notifications

Notifications are sent by the Vercel API route [`api/notifications.js`](api/notifications.js) through Resend. The database migration sends an alert for each non-anonymous signup, a message to the thread author when someone comments, a message to a comment author when someone replies, and a post-like email only at 1, 10, 50, and 100 likes. Each like threshold is sent once per post, and users do not get email about their own actions.

1. Create a Resend account, verify the sending domain, and create an API key.
2. Add these environment variables to the Vercel project, then redeploy:
   - `RESEND_API_KEY`: the Resend API key.
   - `NOTIFICATION_FROM_EMAIL`: set to `Fandom Room <info@fandomroom.com>`.
   - `ADMIN_NOTIFICATION_EMAIL`: set to `info@fandomroom.com` (these are also the code defaults).
   - `NOTIFICATION_WEBHOOK_SECRET`: a long random secret used only between Supabase and the API route.
3. In Supabase SQL Editor, save the same webhook secret in Vault. Replace the placeholder locally; do not commit the real value:

   ```sql
   select vault.create_secret(
     'PASTE_THE_SAME_RANDOM_SECRET_SET_IN_VERCEL',
     'fandomroom_notification_webhook_secret',
     'Authenticates database-triggered email notification requests'
   );
   ```

4. Confirm the `pg_net` extension is enabled in Supabase Database → Extensions. The migration enables it when possible. If the Vercel route is deployed before these settings are added, email triggers stay dormant until the Vault secret and Vercel variables are configured.

5. To send Supabase Auth confirmation/welcome, password reset, and security emails from the same address, configure custom SMTP in Supabase Dashboard → Authentication → SMTP Settings. Use `info@fandomroom.com` as the sender address and `Fandom Room` as the sender name. With Resend, use host `smtp.resend.com`, port `465`, username `resend`, and the Resend API key as the password. Verify `fandomroom.com` with Resend first. Supabase Auth sends its confirmation emails through its own SMTP configuration, separate from the app notification API.
