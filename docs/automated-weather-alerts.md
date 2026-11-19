# FARMCAST EA automated weather alerts (test mode)

## What this release does
- Supabase Cron (`pg_cron`) calls `/api/weather-alerts` every 12 hours (twice daily).
- The endpoint fetches a three-day forecast from Open-Meteo.
- It detects heavy rainfall (at least 30 mm/day), high heat (at least 35°C), and a three-day low-rainfall period.
- It sends practical advice only when a threshold is reached.
- Alerts are deduplicated by location, alert type and forecast date.
- Every run is restricted to rows in `weather_alert_targets` where both `enabled=true` and `test_mode=true`.
- The migration seeds a single test target only if exactly one active Telegram subscription exists, at Katooke B, Wakiso, Uganda.
- No other Telegram subscribers can receive scheduled alerts in this release.

## Required Vercel Production variables
Existing variables are reused:
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`
- `TELEGRAM_BOT_TOKEN`

Add one new server-only variable:
- `WEATHER_ALERT_HMAC_SECRET`: a private random value of at least 32 characters. Store the same value in Supabase Vault as `farmcast_weather_alert_hmac_secret`. The database sends only an HMAC signature, never the secret itself. Do not paste it into chat or commit it.

## Supabase scheduler setup
1. Apply `supabase/migrations/202611180003_weather_alert_scheduler_extensions.sql` to enable `pg_cron` and `pg_net`.
2. In Supabase Dashboard → Integrations → Vault, create a secret named `farmcast_weather_alert_hmac_secret` with the exact same value as Vercel's `WEATHER_ALERT_HMAC_SECRET`.
3. Run the scheduling SQL in `docs/weather-alerts-schedule.sql` once. It creates a 12-hour job that signs each request with HMAC SHA-256 and calls the Vercel endpoint.
4. Check Integrations → Cron and confirm the job is enabled.

Do not use a `NEXT_PUBLIC_` or `VITE_` prefix for secrets.

## Deployment sequence
1. Apply `supabase/migrations/202611180002_weather_alerts_test_mode.sql` to production Supabase.
2. Add `WEATHER_ALERT_HMAC_SECRET` to Vercel Production and redeploy the production project.
3. Confirm the deployment includes `api/weather-alerts.js`.
4. Create the matching secret in Supabase Vault and run `docs/weather-alerts-schedule.sql` once.
5. Confirm the Supabase Cron job named `farmcast-weather-alerts-every-twelve-hours` is enabled.
6. Review `weather_alert_targets`: exactly one row should exist, with `test_mode=true`, location Katooke B, Wakiso, and linked to the user's active Telegram subscription.
7. Review `weather_alert_logs` after the first scheduled run. The endpoint never targets subscriptions without an enabled test target.

## Safety and limitations
- Automatic weather sending is test-only. Do not switch any target to `test_mode=false` until the user explicitly approves a wider rollout and the alert thresholds are validated.
- Open-Meteo forecasts are estimates, not official warnings. Messages advise farmers to check local conditions.
- The current target is a single Wakiso test location, not a regional rollout.
- The Supabase Cron schedule is UTC-based: `0 */12 * * *` (00:00 and 12:00 UTC). Actual request processing may begin shortly after the scheduled time.
