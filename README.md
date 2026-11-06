# TalkAnime

TalkAnime is a discussion UI prototype and a Manifest V3 Chrome extension.

## Load the unpacked extension

1. Open `chrome://extensions` in Chrome and turn on **Developer mode**.
2. If TalkAnime is already listed, click its **Reload** button. Otherwise, click **Load unpacked** and choose this project folder.
3. Refresh the Crunchyroll or AnimeHeaven tab you want to discuss.
4. Click the TalkAnime toolbar icon. It scans the active page and opens the side panel to the detected anime or episode discussion.

The extension reads the active page only when you click its toolbar icon. It currently checks Crunchyroll and AnimeHeaven. If a page does not expose a recognizable title or episode, the panel reports that instead of guessing.

## Connect Supabase

The discussion panel can use the Supabase project `zbayifekoqasimvqreav` for shared posts, replies, likes, and follows. To finish enabling it:

1. In the Supabase Dashboard for that project, enable **Anonymous Sign-Ins** under Authentication settings.
2. Run [`supabase/migrations/202611040001_talkanime_discussions.sql`](supabase/migrations/202611040001_talkanime_discussions.sql) in the SQL Editor.
3. Copy the project's **publishable key** (or legacy `anon` key) into `publishableKey` in [`supabase/config.js`](supabase/config.js). This key is intended to be public; never use a `service_role` or secret key in the extension.
4. Reload TalkAnime from `chrome://extensions` and refresh the viewing tab.

The extension creates an anonymous Supabase identity and keeps its session in the extension's local browser storage. Anonymous identities are not recoverable on another device or after browser data is cleared. Account registration and profile editing are not implemented yet. If the publishable key is absent, the extension remains in its local demo mode.
