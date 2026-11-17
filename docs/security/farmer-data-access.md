# FARMCAST EA farmer-data privacy remediation

## Why this change is needed

The live Supabase project currently has public SELECT policies on `public.farmers` and `public.observations`. The farmers table contains names and phone numbers. Row-level security is enabled, but permissive public SELECT policies make those records readable to unauthenticated clients.

The current pilot database contains one farmer record. This remediation preserves existing farmer and observation rows.

## Application changes

- The public Wakiso pilot no longer reads farmer or observation rows from Supabase.
- The connection badge no longer uses a public SELECT as a health check.
- Dashboard figures and CSV exports are limited to the current browser session.
- Both registration experiences collect required registration-data consent separately from optional WhatsApp consent.
- Successful farmer registrations include a registration-consent timestamp.
- Regional Field Pulse provides crop- and growth-stage-aware field checks based on forecast context. It is general decision support, not a diagnosis or pesticide prescription.

## Production database migration

Apply `supabase/migrations/202611170001_farmer_registration_privacy.sql` only after the privacy-safe application has been deployed.

The migration:
1. Adds nullable `registration_consent_at` so existing rows are not assigned consent retroactively.
2. Removes public SELECT policies on `farmers` and `observations`.
3. Replaces the permissive public farmer INSERT policy with validation for required fields, phone format, supported language and a non-null consent timestamp.
4. Revokes direct execution of `public.rls_auto_enable()` from `PUBLIC`, `anon` and `authenticated`.

The `ensure_rls` event trigger remains installed. The revoke is intended to remove direct API execution by public client roles, not to disable the trigger.

The existing observation INSERT policy is retained for the pilot. Public observation submissions still need server-side validation, abuse controls and rate limiting before broad public rollout.

## Verification after deployment and database remediation

1. Anonymous SELECT from `farmers` is denied.
2. Anonymous SELECT from `observations` is denied.
3. Existing farmer and observation row counts remain unchanged.
4. A new farmer registration inserts successfully with a consent timestamp.
5. A new field observation still inserts successfully.
6. The public dashboard does not download existing personal records.
7. Supabase security advisors are rerun; remaining findings are reviewed.

## Admin reporting

Cumulative farmer analytics should be delivered through a separate authenticated admin experience or a carefully designed aggregate-only endpoint. Do not restore public row-level SELECT to make the dashboard work.
