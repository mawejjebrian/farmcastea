# Supabase setup — FARMCAST EA

This repository includes a database foundation, not a connected production backend yet.

## Setup
1. Create a Supabase project.
2. Open **SQL Editor** and run `supabase/migrations/202611160001_regional_foundation.sql`.
3. In **Project Settings → API**, copy the Project URL and publishable/anon key.
4. Put those values in your deployment environment using the names in `.env.example`.
5. Do not put a service-role key in frontend code, GitHub, screenshots, or public environment variables.

## Tables
Profiles, country framework, hierarchical administrative areas, farms, farm crops, field observations, weather snapshots and sourced advisories.

## Security boundaries
- RLS is enabled on every table.
- A new user can create only their own basic farmer profile. Self-service role escalation is blocked.
- Farmers can manage their own farms and crops. Observation creation is restricted to the authenticated farm owner.
- Publicly curated reference data and published advisories are read-only to authenticated users.
- Privileged writes (official advisories, weather ingestion, administrative data and role assignment) require a trusted server-side process/service role. That process has not yet been deployed.

## Important
- The country list is a planning framework. Do not seed unverified administrative boundaries or claim national operational coverage.
- Field notes currently saved by the browser prototype remain local to that device. They are not automatically uploaded to Supabase.
- Do not collect real farmer personal data until authentication, privacy notice, retention and support processes have been reviewed.
