# FARMCAST EA Telegram bot foundation

## Current scope
This branch adds a Telegram webhook foundation only. It does not send broadcasts, change the existing WhatsApp workflow, alter production data, or set the Telegram webhook.

## Required server-only Vercel variables
- `TELEGRAM_BOT_TOKEN`: the BotFather token; configure as a **Secret**, never as a client/public variable.
- `TELEGRAM_WEBHOOK_SECRET`: a newly generated random value using only letters, numbers, underscores, or hyphens (1–256 characters).
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY` (preferred) or `SUPABASE_SERVICE_ROLE_KEY`

Do not put these values in source code, browser JavaScript, GitHub, or chat messages. Vercel environment-variable changes apply to new deployments, not deployments that already exist.

## Database migration
Review and apply `supabase/migrations/202611180001_telegram_bot_foundation.sql` only after approval. The migration creates isolated Telegram subscription, delivery-log, and webhook-idempotency tables. RLS is enabled and direct anon/authenticated access is revoked; server-side service-role access is required.

## Webhook activation (not performed by this branch)
After a reviewed Preview deployment is available and its Preview environment contains the required variables, configure Telegram's webhook to:

`https://<preview-host>/api/telegram-webhook`

Use Telegram's `setWebhook` method with the same `TELEGRAM_WEBHOOK_SECRET` as `secret_token`, and restrict allowed updates to `message` and `callback_query`. Do not point the bot at production until the owner approves a production release.

## Consent behavior
- A user must open the bot and send `/start`.
- The bot asks for Telegram-specific consent with explicit Yes/No buttons.
- Only an affirmative callback creates an active subscription.
- `/stop` marks the subscription as unsubscribed.
- Existing WhatsApp consent is never reused as Telegram consent.
- This foundation contains no admin broadcast endpoint or automatic bulk sender.

## Safe test plan
1. Apply migration to a non-production/test database first.
2. Deploy only to Vercel Preview with Preview-only credentials.
3. Set the webhook to the Preview endpoint.
4. Test /start, decline, accept, /stop, duplicate webhook retries, and invalid webhook secret using the owner's own Telegram account only.
5. Verify database rows and delivery logs; do not message farmers.
6. Review admin authentication, targeting, rate limiting, queueing, and opt-out enforcement before adding broadcast functionality.
