-- FARMCAST EA Telegram subscriptions are separate from WhatsApp consent.
-- Apply only after review; this file is intentionally not executed against production.
create table if not exists public.telegram_subscriptions (
  id uuid primary key default gen_random_uuid(),
  chat_id text not null unique,
  telegram_user_id text not null,
  username text,
  first_name text,
  country text,
  sub_county text,
  crop text,
  preferred_language text not null default 'English',
  consent_status text not null default 'pending'
    check (consent_status in ('pending', 'subscribed', 'unsubscribed')),
  consent_version text,
  consent_at timestamptz,
  opted_out_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint telegram_consent_consistency check (
    (consent_status <> 'subscribed' or consent_at is not null)
  )
);

create index if not exists telegram_subscriptions_active_idx
  on public.telegram_subscriptions (country, sub_county, crop, preferred_language)
  where consent_status = 'subscribed';

create table if not exists public.telegram_logs (
  id uuid primary key default gen_random_uuid(),
  chat_id text,
  message_type text not null,
  status text not null check (status in ('sent', 'failed')),
  telegram_message_id bigint,
  error_code integer,
  created_at timestamptz not null default now()
);

create index if not exists telegram_logs_created_at_idx
  on public.telegram_logs (created_at desc);

-- Store Telegram update IDs to make webhook retries idempotent.
create table if not exists public.telegram_updates (
  update_id bigint primary key,
  received_at timestamptz not null default now()
);

alter table public.telegram_subscriptions enable row level security;
alter table public.telegram_logs enable row level security;
alter table public.telegram_updates enable row level security;

revoke all on public.telegram_subscriptions from anon, authenticated;
revoke all on public.telegram_logs from anon, authenticated;
revoke all on public.telegram_updates from anon, authenticated;
grant all on public.telegram_subscriptions to service_role;
grant all on public.telegram_logs to service_role;
grant all on public.telegram_updates to service_role;
