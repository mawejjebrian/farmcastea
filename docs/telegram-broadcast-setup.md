# FARMCAST EA Telegram setup

This is a consent-first Telegram broadcast integration. It is intentionally separate from WhatsApp and does not import WhatsApp consent.

## Components
- `/api/telegram-webhook`: handles /start, consent buttons, /stop, /country and /crop.
- `/api/telegram-admin`: approved-admin-only webhook setup, subscriber preview and manual 10-recipient batches.
- `/admin/telegram.html`: protected admin screen using the existing Supabase Auth allowlist.
- `telegram_subscriptions`: chat IDs, Telegram-specific consent and targeting preferences.
- `telegram_delivery_logs`: sent/failed delivery audit trail.

## Required Vercel Production environment variables
Existing variables must remain unchanged:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SECRET_KEY` (preferred) or `SUPABASE_SERVICE_ROLE_KEY`
- `FARMCAST_ADMIN_EMAILS`

Add:
- `TELEGRAM_BOT_TOKEN`: token from BotFather; server-side only.
- `TELEGRAM_WEBHOOK_SECRET`: generate at least 32 random hexadecimal characters (for example, `openssl rand -hex 32`). Keep it private.

Never add the bot token or Supabase secret key to a browser variable, HTML file, or Git commit.

## Database and Data API preparation
1. Review and apply `supabase/migrations/202611180001_telegram_subscriptions.sql` to the intended Supabase project.
2. The migration enables RLS and grants table access only to `service_role`; it does not grant access to `anon` or `authenticated`.
3. Supabase projects now require explicit Data API exposure for new public tables. In Supabase Dashboard → Integrations → Data API settings, expose `telegram_subscriptions` and `telegram_delivery_logs` so the server-side service key can reach them through PostgREST. Do not grant browser roles access. Confirm the service-role requests work after exposure.
4. Run Supabase Security Advisor and confirm both tables have RLS enabled and no anon/authenticated grants.

## Release sequence
1. Merge/deploy this branch only after reviewing the pull request and applying the migration.
2. Add the two Telegram variables to Vercel Production; do not change existing Gemini or Supabase values.
3. Open `https://farmcastea.vercel.app/admin/telegram.html`, sign in as an approved admin, and click **Connect / refresh bot webhook**.
4. Open `https://t.me/FarmcastEA_bot` in your own Telegram account and tap Start. Tap **Yes, subscribe** only for your own controlled test account.
5. Confirm the subscriber is visible in the preview count. Do not send a broadcast to farmers during the first test.
6. For a controlled delivery test, send a short test message only to the admin's own Telegram account after explicit approval.
7. Share the bot link with farmers only after the full consent and unsubscribe flow has been tested.

## Bot commands
- `/start`: asks for Telegram-specific opt-in.
- `/stop`: immediately unsubscribes the chat.
- `/country Uganda`: sets country preference for active subscribers.
- `/crop maize`: sets crop preference for active subscribers.
- `/help`: lists commands.

## Broadcast safeguards
- Admin login and exact email allowlist are required.
- Preview counts active subscriptions only.
- Each explicit send click handles at most 10 recipients.
- A confirmation dialog is required for every batch.
- Sends are never scheduled or triggered automatically.
- Each attempted delivery is logged as sent or failed.
- Telegram users must initiate the bot chat before it can message them.

## Important limitations
- This first release is a manual broadcast workflow, not a scheduler or automatic weather-alert engine.
- Telegram's send API can still reject individual messages (for example, if a user blocks the bot); failures are logged.
- Country and crop filters are exact text matches; encourage consistent preference values.
- Do not expose raw chat IDs or export subscriber data to public pages.
