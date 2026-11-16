# FARMCAST EA farmer-data privacy remediation

## Why this change is needed

The live Supabase project currently has public SELECT policies on `public.farmers` and `public.observations`. The farmers table contains names and phone numbers. Row-level security is enabled, but permissive public SELECT policies make those records readable to unauthenticated clients.

The current pilot database contains one farmer record. This remediation must preserve it.

## Application changes in this branch

- The public Wakiso pilot no longer reads farmer or observation rows from Supabase.
- The connection badge is marked as configured until a real insert succeeds; it no longer treats a public SELECT as a health check.
- Dashboard figures and CSV export are explicitly session-only. They must not be represented as total pilot enrolment.
- Successful registration and observation inserts mark the database connection as verified.
- The regional experience adds FARMCAST Field Pulse: crop- and growth-stage-aware field checks that use forecast rain probability and rainfall totals. The prompts are general decision support, not pesticide instructions or a substitute for extension advice.

## Production database change — apply only after the privacy-safe application is deployed

Run as a database owner after confirming the updated pilot page is deployed:

```sql
begin;

drop policy if exists "Allow public select of farmers" on public.farmers;
drop policy if exists "Allow public select of observations" on public.observations;

revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

commit;
```

The `ensure_rls` event trigger remains installed and will continue to execute its function as the event-trigger owner. The revoke removes direct API execution by public client roles.

Do not drop tables, truncate rows, disable RLS, or remove the existing INSERT policies as part of this step. Public registration/observation inserts remain a separate abuse-control concern; add server-side validation and rate limiting before opening the pilot widely.

## Verification after deployment and database remediation

1. Anonymous SELECT from `farmers` must be denied.
2. Anonymous SELECT from `observations` must be denied.
3. Existing farmer row count must remain unchanged.
4. New farmer registration must still insert successfully.
5. New field observation must still insert successfully.
6. The public dashboard must show session-only counts and must not download existing personal records.
7. Supabase security advisors must be rerun; investigate any remaining findings.

## Admin reporting

Cumulative farmer analytics should be delivered through a separate authenticated admin experience or a carefully designed aggregate-only endpoint. Do not restore public row-level SELECT to make the dashboard work.
