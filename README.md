# FARMCAST EA

East African climate intelligence for farmers.

This repository is being initialised to preserve the existing FARMCAST EA prototypes before a staged upgrade. The recovery branch will contain the original application files and subsequent upgrade work. The live deployment on the default branch is not being replaced by this recovery step.

## Project status
- Existing prototypes recovered from the project owner's ChatGPT Library.
- Upgrade work will be developed and tested on a separate branch.
- Production readiness, live integrations, data protection, and regional coverage must be verified before release.

## Recovery and upgrade branch

Branch: `recovery/restore-existing-prototypes`

- `index.html`: upgraded static pilot preview entry point.
- `app/index.html`: same upgraded application source in the app folder.
- `legacy/`: preserved original application and earlier concept prototype.

### Upgrade safeguards
- Database badge reflects an actual Supabase read check, not merely client initialization.
- Registration stores the user's actual WhatsApp consent selection.
- Failed database writes are reported as failures and are not shown as successful submissions.
- Farmer table values are rendered as text to reduce HTML injection risk.
- Advisory delivery metrics are not fabricated; zero is shown until verified delivery records exist.
- Messaging automation is clearly marked as not yet connected.

### Verification still required before production
- Confirm Supabase table schemas, row-level security policies, and permissions using a test account.
- Run end-to-end registration and observation tests against the live Supabase project.
- Confirm the Vercel project is configured to deploy this repository and branch; this recovery branch has not been deployed to production.
- Connect and test WhatsApp/SMS delivery before advertising automated alerts.
