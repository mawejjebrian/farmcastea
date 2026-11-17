-- FARMCAST EA platform hardening: separate consent evidence and validated field observations.
-- Development migration: review and test on a non-production database before applying to production.

begin;

alter table public.farmers
  add column if not exists whatsapp_consent_at timestamptz,
  add column if not exists registration_consent_version text not null default '2026-11-v1';

-- Consent must be explicit. Existing true values without evidence are deliberately
-- not eligible for WhatsApp export until the farmer's opt-in is reconfirmed.
alter table public.farmers
  alter column whatsapp_consent set default false;

update public.farmers
set whatsapp_consent = false
where whatsapp_consent_at is null;

drop policy if exists "Allow validated farmer registrations" on public.farmers;
create policy "Allow validated farmer registrations"
  on public.farmers
  for insert
  to anon, authenticated
  with check (
    length(trim(full_name)) between 2 and 100
    and length(trim(sub_county)) between 2 and 160
    and length(trim(crop)) between 2 and 60
    and length(trim(phone_number)) between 7 and 24
    and phone_number ~ '^[+]?[0-9 ()-]{7,24}$'
    and preferred_language in ('English', 'Luganda', 'Kiswahili')
    and registration_consent_at is not null
    and (
      whatsapp_consent = false
      or (whatsapp_consent = true and whatsapp_consent_at is not null)
    )
  );

alter table public.observations
  add column if not exists country text not null default 'Uganda',
  add column if not exists crop text not null default 'Other',
  add column if not exists issue_type text not null default 'General field observation',
  add column if not exists severity text not null default 'Unspecified',
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists observation_consent_at timestamptz;

drop policy if exists "Allow public inserts to observations" on public.observations;
create policy "Allow validated field observations"
  on public.observations
  for insert
  to anon, authenticated
  with check (
    length(trim(sub_county)) between 2 and 160
    and length(trim(country)) between 2 and 80
    and length(trim(crop)) between 2 and 60
    and length(trim(issue_type)) between 2 and 80
    and severity in ('Low', 'Moderate', 'High', 'Unspecified')
    and length(trim(rainfall_observed)) between 2 and 60
    and (comments is null or length(comments) <= 1200)
    and observation_consent_at is not null
    and (latitude is null or latitude between -90 and 90)
    and (longitude is null or longitude between -180 and 180)
  );

commit;
