-- FARMCAST EA farmer registration privacy and consent hardening
-- Apply only after the privacy-safe application in PR #6 is deployed.
-- Preserves all existing farmer and observation records.

begin;

alter table public.farmers
  add column if not exists registration_consent_at timestamptz;

drop policy if exists "Allow public select of farmers" on public.farmers;
drop policy if exists "Allow public select of observations" on public.observations;

drop policy if exists "Allow public inserts to farmers" on public.farmers;
create policy "Allow validated farmer registrations"
  on public.farmers
  for insert
  to anon, authenticated
  with check (
    length(trim(full_name)) between 2 and 100
    and length(trim(sub_county)) between 2 and 160
    and length(trim(crop)) between 2 and 60
    and length(trim(phone_number)) between 7 and 24
    and phone_number ~ '^\\+?[0-9 ()-]{7,24}$'
    and preferred_language in ('English', 'Luganda', 'Kiswahili')
    and registration_consent_at is not null
  );

revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

commit;
