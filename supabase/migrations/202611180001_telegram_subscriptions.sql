-- Telegram-specific subscriptions and delivery audit trail.
-- Existing WhatsApp consent is deliberately not reused.
create extension if not exists pgcrypto;
create table if not exists public.telegram_subscriptions (
  id uuid primary key default gen_random_uuid(),
  chat_id text not null unique,
  telegram_user_id text,
  username text,
  first_name text,
  country text,
  crop text,
  preferred_language text not null default 'English'
    check (preferred_language in ('English', 'Luganda', 'Kiswahili')),
  status text not null default 'pending'
    check (status in ('pending', 'active', 'unsubscribed')),
  consent_at timestamptz,
  opted_out_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint telegram_active_requires_consent check (status <> 'active' or consent_at is not null)
);
create index if not exists telegram_subscriptions_active_country_crop_idx
  on public.telegram_subscriptions (country, crop) where status = 'active';
create table if not exists public.telegram_delivery_logs (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,
  subscription_id uuid references public.telegram_subscriptions(id) on delete set null,
  chat_id text not null,
  message_text text not null,
  status text not null check (status in ('sent', 'failed')),
  telegram_message_id text,
  error_code text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists telegram_delivery_logs_batch_idx on public.telegram_delivery_logs (batch_id, created_at desc);
create index if not exists telegram_delivery_logs_chat_idx on public.telegram_delivery_logs (chat_id, created_at desc);
alter table public.telegram_subscriptions enable row level security;
alter table public.telegram_delivery_logs enable row level security;
revoke all on public.telegram_subscriptions from anon, authenticated;
revoke all on public.telegram_delivery_logs from anon, authenticated;
grant all on public.telegram_subscriptions to service_role;
grant all on public.telegram_delivery_logs to service_role;
