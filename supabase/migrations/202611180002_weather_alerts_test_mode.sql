-- Automated weather alerts: isolated test targets only.
-- The initial target is created only when exactly one active Telegram subscriber exists.
-- Test mode is enabled by default and is enforced again by the scheduled API route.

create table if not exists public.weather_alert_targets (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null unique references public.telegram_subscriptions(id) on delete cascade,
  location_name text not null,
  latitude double precision not null,
  longitude double precision not null,
  country text not null default 'Uganda',
  enabled boolean not null default true,
  test_mode boolean not null default true,
  created_at timestamptz not null default now(),
  constraint weather_alert_targets_latitude_check check (latitude between -90 and 90),
  constraint weather_alert_targets_longitude_check check (longitude between -180 and 180)
);

create table if not exists public.weather_alert_logs (
  id uuid primary key default gen_random_uuid(),
  target_id uuid not null references public.weather_alert_targets(id) on delete cascade,
  alert_key text not null,
  alert_type text not null,
  message_text text not null,
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  telegram_message_id text,
  error_code text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (target_id, alert_key)
);

alter table public.weather_alert_targets enable row level security;
alter table public.weather_alert_logs enable row level security;
revoke all on public.weather_alert_targets from anon, authenticated;
revoke all on public.weather_alert_logs from anon, authenticated;
grant all on public.weather_alert_targets to service_role;
grant all on public.weather_alert_logs to service_role;

-- Coordinates identify Katooke B in Nabweru, Wakiso. This seeds no target unless
-- there is exactly one active Telegram subscriber (the controlled test account).
insert into public.weather_alert_targets
  (subscription_id, location_name, latitude, longitude, country, enabled, test_mode)
select s.id, 'Katooke B, Wakiso, Uganda', 0.37949, 32.5406, 'Uganda', true, true
from public.telegram_subscriptions s
where s.status = 'active'
  and (select count(*) from public.telegram_subscriptions where status = 'active') = 1
on conflict (subscription_id) do nothing;
