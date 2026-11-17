# FARMCAST EA development and release checklist

## Safety boundary

Vercel Preview and Production can point to the same Supabase project if their environment variables contain the same project URL and keys. A Preview deployment is not a separate database. The current Preview configuration was entered using the existing FARMCAST EA Supabase project, so treat it as production data until a separate development Supabase project is created and its credentials are placed in Vercel Preview.

Do not apply the new migration to the existing project or test writes against it as part of Preview testing.

## Development environment

1. Create a separate Supabase project named FARMCAST EA Development.
2. Configure Vercel Preview with that development project's URL, publishable key and server-only secret key. Keep Production variables unchanged.
3. Create and confirm a development administrator account.
4. Set `FARMCAST_ADMIN_EMAILS` for Preview to the approved administrator email.
5. Apply migrations in order to the development project:
   - `202611170001_farmer_registration_privacy.sql` only if the dev project does not already have the privacy migration.
   - `202611170002_platform_privacy_and_observations.sql`.
6. Enable Supabase Auth leaked-password protection.
7. Redeploy the Preview branch after the Preview variables are updated.

## Preview acceptance tests

- Public farmer registration succeeds with data consent and WhatsApp opt-in unchecked.
- WhatsApp opt-in is optional and stores its own timestamp only when checked.
- Admin contact list excludes every record without separate WhatsApp consent evidence.
- Admin sign-in rejects unconfirmed or non-allowlisted users.
- CSV and Excel import requires separate data and WhatsApp consent dates.
- Duplicate numbers are skipped; malformed numbers and dates are rejected.
- CSV exports neutralize spreadsheet formula-leading values.
- Opt-out sets WhatsApp consent false and records the opt-out timestamp.
- Field observations require consent and are centrally stored without collecting a farmer's name or phone number.
- Public users cannot read farmer or observation records.
- AI requests go through `/api/assistant`; the Gemini key is server-side only. Test English, Luganda and Kiswahili, error handling, and the agricultural safety disclaimer.
- Weather and geocoding failures show clear unavailable states rather than fabricated data.
- Mobile layout and PWA install/offline behavior are checked on Android.

Use controlled dummy development records only. Do not add real farmers unless they have given the required consent. Delete dummy records after tests.

## Production release

1. Review the Preview acceptance tests and security/performance advisors.
2. Back up the production database.
3. Review and apply the migration to Production in a planned maintenance window.
4. Add the matching Production environment variables and deploy only after the migration succeeds.
5. Confirm registration, opt-out and admin access on Production.
6. Monitor Supabase logs and Vercel function logs after release.

## Not included yet

- Automatic WhatsApp message sending or Meta Cloud API.
- Verified agronomic recommendations for every country/crop.
- Country-specific official weather or extension data partnerships.
- A complete AI audit trail, human expert review workflow or guaranteed diagnosis.
