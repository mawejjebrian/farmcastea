-- FARMCAST EA regional data foundation
-- Apply in Supabase SQL Editor. Never expose the service_role key in a browser.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  preferred_language text not null default 'en',
  role text not null default 'farmer' check (role in ('farmer','extension_officer','country_admin','regional_admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.countries (
  code text primary key check (code ~ '^[A-Z]{2,3}$'),
  name text not null unique,
  enabled boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_areas (
  id uuid primary key default gen_random_uuid(),
  country_code text not null references public.countries(code),
  parent_id uuid references public.admin_areas(id) on delete restrict,
  level text not null check (level in ('region','district','county','sub_county','ward','community')),
  name text not null,
  source_name text,
  source_version text,
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  unique(country_code,parent_id,level,name)
);

create table if not exists public.farms (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  country_code text not null references public.countries(code),
  admin_area_id uuid references public.admin_areas(id),
  farm_name text,
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  area_hectares numeric(12,3) check (area_hectares is null or area_hectares >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.farm_crops (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  crop_name text not null,
  variety text,
  planting_date date,
  season_label text,
  created_at timestamptz not null default now()
);

create table if not exists public.field_observations (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  crop_name text,
  observation_type text not null,
  severity text not null check (severity in ('low','moderate','high','unknown')),
  description text not null check (char_length(description) between 1 and 4000),
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.weather_snapshots (
  id uuid primary key default gen_random_uuid(),
  country_code text not null references public.countries(code),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  provider text not null default 'open-meteo',
  observed_at timestamptz not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.advisories (
  id uuid primary key default gen_random_uuid(),
  country_code text not null references public.countries(code),
  admin_area_id uuid references public.admin_areas(id),
  crop_name text,
  language_code text not null default 'en',
  title text not null,
  body text not null,
  source_name text,
  source_url text,
  status text not null default 'draft' check (status in ('draft','reviewed','published','withdrawn')),
  valid_from timestamptz,
  valid_until timestamptz,
  created_at timestamptz not null default now()
);


insert into public.countries (code,name,enabled) values
('UG','Uganda',true),('KE','Kenya',false),('TZ','Tanzania',false),
('RW','Rwanda',false),('BI','Burundi',false),('SS','South Sudan',false),
('ET','Ethiopia',false),('SO','Somalia',false),('DJ','Djibouti',false),
('CD','Democratic Republic of the Congo',false),('SD','Sudan',false),('ER','Eritrea',false)
on conflict (code) do update set name=excluded.name;

create index if not exists farms_owner_idx on public.farms(owner_id);
create index if not exists observations_farm_time_idx on public.field_observations(farm_id, observed_at desc);
create index if not exists admin_areas_country_idx on public.admin_areas(country_code, level);
create index if not exists weather_location_time_idx on public.weather_snapshots(country_code, observed_at desc);
create index if not exists advisories_country_status_idx on public.advisories(country_code, status, valid_from);

alter table public.profiles enable row level security;
alter table public.countries enable row level security;
alter table public.admin_areas enable row level security;
alter table public.farms enable row level security;
alter table public.farm_crops enable row level security;
alter table public.field_observations enable row level security;
alter table public.weather_snapshots enable row level security;
alter table public.advisories enable row level security;

-- A new account can create only its own basic farmer profile. Privileged roles
-- must be assigned by a trusted administrator using a protected server process.
drop policy if exists "profile self read" on public.profiles;
create policy "profile self read" on public.profiles for select to authenticated using (id = auth.uid());
drop policy if exists "profile self create as farmer" on public.profiles;
create policy "profile self create as farmer" on public.profiles for insert to authenticated with check (id = auth.uid() and role = 'farmer');
drop policy if exists "profile self update basic fields" on public.profiles;
create policy "profile self update basic fields" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid() and role = 'farmer');

drop policy if exists "authenticated read countries" on public.countries;
create policy "authenticated read countries" on public.countries for select to authenticated using (true);
drop policy if exists "authenticated read admin areas" on public.admin_areas;
create policy "authenticated read admin areas" on public.admin_areas for select to authenticated using (true);
drop policy if exists "authenticated read published advisories" on public.advisories;
create policy "authenticated read published advisories" on public.advisories for select to authenticated using (status = 'published' and (valid_until is null or valid_until > now()));
drop policy if exists "authenticated read weather" on public.weather_snapshots;
create policy "authenticated read weather" on public.weather_snapshots for select to authenticated using (true);

drop policy if exists "owner manages farms" on public.farms;
create policy "owner manages farms" on public.farms for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "farm owner manages crops" on public.farm_crops;
create policy "farm owner manages crops" on public.farm_crops for all to authenticated
using (exists (select 1 from public.farms f where f.id = farm_id and f.owner_id = auth.uid()))
with check (exists (select 1 from public.farms f where f.id = farm_id and f.owner_id = auth.uid()));
drop policy if exists "farm owner reads observations" on public.field_observations;
create policy "farm owner reads observations" on public.field_observations for select to authenticated
using (author_id = auth.uid() and exists (select 1 from public.farms f where f.id = farm_id and f.owner_id = auth.uid()));
drop policy if exists "farm owner creates observations" on public.field_observations;
create policy "farm owner creates observations" on public.field_observations for insert to authenticated
with check (author_id = auth.uid() and exists (select 1 from public.farms f where f.id = farm_id and f.owner_id = auth.uid()));

-- No browser-facing write policies are provided for weather ingestion,
-- official advisories, country administration, or role assignment.
