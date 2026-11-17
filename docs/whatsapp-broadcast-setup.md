# FARMCAST EA Farmer Contacts and Manual WhatsApp Workflow

The private contact workspace is available at /admin/. It is designed for the manual WhatsApp Business app workflow. It does not send messages, connect to Meta's Cloud API, or require Meta access tokens, webhooks, message templates, or WhatsApp API billing.

## What the workspace does

- Shows only farmers who have explicitly opted in to WhatsApp updates.
- Allows an administrator to add one farmer at a time.
- Imports up to 500 contacts from CSV or Excel.
- Skips duplicate WhatsApp numbers.
- Filters eligible contacts by sub-county, crop, and preferred language.
- Exports the filtered, opted-in contacts to CSV for the WhatsApp Business app.
- Allows an administrator to record an opt-out. Opted-out farmers are excluded from future exports.

## Existing registration form

The public FARMCAST EA registration form already collects the farmer's full name, WhatsApp phone number, sub-county, crop, preferred language, and a separate optional WhatsApp consent choice. The contact workspace reads only rows where whatsapp_consent is true. It does not expose farmer contact data on the public website.

## One-time administrator setup

1. In Supabase Dashboard, open Authentication → Users and create or invite the administrator account.
2. Confirm the administrator email address.
3. In Vercel Project Settings → Environment Variables, set these server-side variables:
   - SUPABASE_URL
   - SUPABASE_ANON_KEY (the project's publishable key can be used for this validation)
   - SUPABASE_SECRET_KEY (preferred) or SUPABASE_SERVICE_ROLE_KEY (legacy)
   - FARMCAST_ADMIN_EMAILS (the exact approved administrator email address; multiple addresses may be comma-separated)
4. Never place a Supabase secret/service-role key in HTML, GitHub, or any browser-exposed environment variable.
5. Redeploy the Vercel project after setting the variables.
6. Open /admin/ and sign in with the confirmed administrator account.

No database migration is required for this contact-only version. It uses the existing farmers table and existing consent fields. It does not create broadcast tables or change public database policies.

## Import template

Download /admin/farmer-import-template.csv. Required columns:

- full_name
- whatsapp_number — international E.164 format, for example +2567XXXXXXXX
- sub_county
- crop
- preferred_language — English, Luganda, or Kiswahili
- data_consent — true only if the farmer agreed to registration data storage/use
- whatsapp_consent — true only if the farmer separately agreed to WhatsApp updates
- consent_recorded_at — date/time when the consent was actually recorded

Both consent values must be true. Do not invent a consent date or mark a farmer as opted in without their permission. Existing phone numbers and duplicates in the same upload are skipped.

## Sending updates manually

1. Sign in to /admin/.
2. Filter the contact list by location, crop, or language if needed.
3. Select Export matching contacts (CSV).
4. Keep the exported file private. Add the eligible farmers to the phone contacts used by your WhatsApp Business account.
5. Create a broadcast list in the WhatsApp Business app and select the relevant saved contacts.
6. Send your weather advisory or farming update. Follow WhatsApp's current broadcast rules; recipients may need to save your business number to receive broadcast messages.
7. Honour opt-out requests immediately. Use the Opt out action in the admin workspace so the number is excluded from future exports.

The website export is a contact-management aid. It does not automatically create a WhatsApp broadcast list or send a message. Keep exported files secure and delete them when no longer needed.

## Security

- Farmer contact records are never fetched by the public website.
- Contact retrieval and updates happen through a server-side API after Supabase Auth validation and exact email allowlist verification.
- The server-only Supabase secret/service-role key is never sent to the browser.
- The API returns only WhatsApp-opted-in farmers.
- Opt-out sets whatsapp_consent to false, excluding the farmer from subsequent exports.
