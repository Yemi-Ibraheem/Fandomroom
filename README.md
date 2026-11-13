# Fandom Room

Fandom Room is the public discussion site at https://www.fandomroom.com, with a Manifest V3 Chrome extension companion. The editorial section lives at https://www.fandomroom.com/blog. Published articles have clean, server-rendered URLs and public comments.

## Load the unpacked extension

1. Open `chrome://extensions` in Chrome and turn on **Developer mode**.
2. If Fandom Room is already listed, click its **Reload** button. Otherwise, click **Load unpacked** and choose this project folder.
3. Open the viewing page you want to discuss.
4. Click the Fandom Room toolbar icon. It scans the active page and opens the side panel to the detected title or episode discussion.

The extension scans HTTP and HTTPS viewing pages across sites when you click its toolbar icon or **Refresh & scan**. The current discussion stays open as you navigate until you scan again. If the title is unclear, enter it in the panel; successful scans hide that form. The comment box appears above the discussion, and ratings switch between the episode and whole show.

## Publish the website

Vercel serves the static website from `index.html`, including the Fandom Room poll and ranking discussion experience. The project uses the `fandomroom.com` and `www.fandomroom.com` production domains. Vercel production deploys from the repository's `main` branch.

## Connect Supabase

The website and discussion panel use the Supabase project `zbayifekoqasimvqreav` for accounts, polls, rankings, images, replies, and the extension's anime discussions. To finish enabling it:

1. In the Supabase Dashboard for that project, enable **Anonymous Sign-Ins** under Authentication settings.
2. Run [`supabase/migrations/202611040001_talkanime_discussions.sql`](supabase/migrations/202611040001_talkanime_discussions.sql), [`supabase/migrations/202611080001_fandomroom_threads.sql`](supabase/migrations/202611080001_fandomroom_threads.sql), [`supabase/migrations/202611100001_email_notifications.sql`](supabase/migrations/202611100001_email_notifications.sql), and [`supabase/migrations/202611110001_signup_profile_fields.sql`](supabase/migrations/202611110001_signup_profile_fields.sql) in the SQL Editor, in that order. Skip any migrations you have already run.
3. Copy the project's **publishable key** (or legacy `anon` key) into `publishableKey` in [`supabase/config.js`](supabase/config.js). This key is intended to be public; never use a `service_role` or secret key in the extension.
4. Reload Fandom Room from `chrome://extensions` and refresh the viewing tab.

To enable saved episode and show ratings for Premium members, also apply [`supabase/migrations/202611120001_media_ratings.sql`](supabase/migrations/202611120001_media_ratings.sql) in the Supabase SQL Editor. The extension's rating control uses the account's Stripe-managed Premium status.

The extension creates an anonymous Supabase identity and keeps its session in the extension's local browser storage. Anonymous identities are not recoverable on another device or after browser data is cleared. If the publishable key is absent, the extension remains in its local demo mode.

The website signup form asks for a username and country. Usernames are public and unique without regard to capitalization. Country is saved privately in the account's Auth metadata.

## Enable Blog articles and Premium publishing

After the existing migrations, run [`supabase/migrations/202611130001_editorial_threads.sql`](supabase/migrations/202611130001_editorial_threads.sql) in Supabase SQL Editor. Sign in to Fandom Room once with the account that should always have publishing access, then add that account as an editor in SQL Editor:

```sql
insert into public.blog_editors(user_id)
select id from auth.users where email = 'YOUR-ACCOUNT-EMAIL'
on conflict (user_id) do nothing;
```

Your account can publish through `/blog` on any plan. Active Premium members can also publish their own articles. Creating new image polls and rankings is now a Premium feature, enforced by the database as well as the site interface. Article comments are public to read and require a signed-in account to post. The migration creates the `blog-images` public cover bucket and the article/comment tables with row-level access policies.

Vercel routes `/blog` to the editorial index and `/blog/{slug}` to server-rendered article HTML with canonical, Open Graph, Twitter, and BlogPosting metadata. `/blog/sitemap.xml` lists published articles; `robots.txt` points crawlers to that sitemap. Deploy the repository to activate these routes. Run the new migration before publishing.

## Customize the signup confirmation email

The signup confirmation is also the welcome email. In Supabase Dashboard → Authentication → Email Templates → **Confirm signup**, set the subject to `Welcome to Fandom Room — confirm your email` and paste the HTML from [`supabase/email-templates/confirm-signup.html`](supabase/email-templates/confirm-signup.html) into the message body. The template includes the required `{{ .ConfirmationURL }}` link and a short introduction to polls, rankings, and discussions. The Supabase Auth SMTP sender should be `info@fandomroom.com` with sender name `Fandom Room`.

## Enable Google sign-in

1. In Google Cloud, create a **Web application** OAuth client. Add `https://www.fandomroom.com` as an authorized JavaScript origin. Add the Supabase callback URI shown on the Supabase Authentication → Sign In / Providers → Google page as an authorized redirect URI (it has the form `https://<project-ref>.supabase.co/auth/v1/callback`).
2. Copy the Google client ID and secret into that Google provider page in Supabase and enable Google.
3. In Supabase Authentication → URL Configuration, set the Site URL to `https://www.fandomroom.com` and allow `https://www.fandomroom.com/**` as a redirect URL. Add the apex domain too if you want to accept redirects there.
4. Save the provider settings. The website's **Continue with Google** button uses the Supabase OAuth flow and returns to the page where sign-in started.

Keep the Google client secret in Supabase only. Do not add it to Vercel or the repository; only the Supabase publishable key is public.
