# FARMCAST EA WhatsApp Broadcast Setup

The WhatsApp workspace lives at `/admin/`. It is separate from the public farmer pilot. Contact details are returned only after the server validates a Supabase Auth session against the `FARMCAST_ADMIN_EMAILS` allowlist.

## 1. Database

Review and apply `supabase/migrations/202611170002_whatsapp_broadcasts.sql` to the FARMCAST EA Supabase project before opening the admin workspace. It adds an opt-out timestamp and private campaign/message tables. The new tables have RLS enabled and no browser-role privileges; the server-side service key is required.

## 2. Create an administrator login

In Supabase Dashboard → Authentication → Users, create or invite the administrator account and confirm its email. Add that exact email address to the Vercel environment variable `FARMCAST_ADMIN_EMAILS`. Multiple addresses may be comma-separated. Do not make the admin email or a role flag editable through public user metadata.

## 3. Vercel environment variables

Set these server-side variables in Vercel Project Settings → Environment Variables. Never put secret values in HTML, GitHub, or a `NEXT_PUBLIC_` / `VITE_` variable.

- `SUPABASE_URL`: project URL
- `SUPABASE_ANON_KEY`: Supabase publishable key (used only to validate a signed-in user)
- `SUPABASE_SECRET_KEY`: preferred server-only Supabase secret key (or `SUPABASE_SERVICE_ROLE_KEY` for a legacy service-role JWT)
- `FARMCAST_ADMIN_EMAILS`: comma-separated approved administrator emails
- `WHATSAPP_ACCESS_TOKEN`: Meta WhatsApp Cloud API access token
- `WHATSAPP_PHONE_NUMBER_ID`: registered WhatsApp Business phone-number ID
- `WHATSAPP_API_VERSION`: supported Graph API version, e.g. the version enabled for your Meta app

Redeploy after adding or changing environment variables.

## 4. Connect Meta WhatsApp Business Platform

Create or use a Meta Business Portfolio, WhatsApp Business Account and business phone number. Complete Meta's Cloud API onboarding, generate a suitable server-side access token with the required WhatsApp messaging permission, and create/submit a message template. Wait until the template is approved before using it in a broadcast. Enter the exact approved template name and language code in the admin workspace.

The sender uses template messages. Business-initiated messages outside the 24-hour customer-service window require an approved template. Meta may charge for template messages; check current pricing and messaging limits in WhatsApp Manager before sending.

## 5. Import existing farmer contacts

Download `/admin/farmer-import-template.csv` and fill these columns:

- `full_name`
- `whatsapp_number` — international E.164 format, e.g. `+2567XXXXXXXX`
- `sub_county`
- `crop`
- `preferred_language` — English, Luganda or Kiswahili
- `data_consent` — true only when the farmer agreed to storage/use of their registration details
- `whatsapp_consent` — true only when the farmer explicitly opted in to WhatsApp updates
- `consent_recorded_at` — ISO date/time when consent was recorded

Rows without both consent flags and a valid consent date are rejected. Existing phone numbers are skipped rather than duplicated. Upload CSV or Excel (.xlsx/.xls) in the admin workspace.

## 6. Sending and monitoring

Create a campaign using an approved template and the template's language code. An optional single body parameter is supported for templates with one text placeholder. The first implementation sends at most 10 recipients per batch; an administrator must deliberately start each next batch. A result marked `accepted` means Meta accepted the API request, not that the message was delivered or read. Delivery/read webhook reconciliation is a later integration step.

Administrators can mark a farmer as opted out. This sets `whatsapp_consent=false` and records the opt-out timestamp; future recipient selection excludes that farmer. Do not re-import an opted-out farmer unless they have explicitly opted in again and a new consent record is available.

## Security and release notes

- No public SELECT policy is created for farmers or the WhatsApp tables.
- The service-role key is used only in `api/whatsapp-admin.js` on the Vercel server.
- Admin access is restricted by a server-side email allowlist and verified Supabase Auth user.
- Do not enable sending until the Meta account, approved template, server secrets and consent records are verified.
- The migration and feature should be reviewed in the pull request before production migration/deployment.
