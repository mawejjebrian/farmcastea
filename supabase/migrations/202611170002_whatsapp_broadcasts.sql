-- FARMCAST EA private WhatsApp broadcast management
-- Private tables are accessed only through the authenticated server-side admin API.
begin;

alter table public.farmers
  add column if not exists whatsapp_opted_out_at timestamptz;

create table if not exists public.whatsapp_broadcasts (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references auth.users(id) on delete set null,
  title varchar(120) not null,
  template_name varchar(120) not null,
  language_code varchar(20) not null,
  template_parameter text,
  filters jsonb not null default '{}'::jsonb,
  status varchar(24) not null default 'draft'
    check (status in ('draft','sending','completed','failed')),
  total_recipients integer not null default 0,
  accepted_count integer not null default 0,
  failed_count integer not null default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.whatsapp_message_events (
  id uuid primary key default gen_random_uuid(),
  broadcast_id uuid not null references public.whatsapp_broadcasts(id) on delete cascade,
  farmer_id uuid not null references public.farmers(id) on delete restrict,
  meta_message_id text,
  status varchar(24) not null
    check (status in ('accepted','failed','delivered','read')),
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (broadcast_id, farmer_id)
);

create index if not exists whatsapp_broadcasts_created_at_idx
  on public.whatsapp_broadcasts (created_at desc);
create index if not exists whatsapp_message_events_broadcast_idx
  on public.whatsapp_message_events (broadcast_id, status);
create index if not exists farmers_whatsapp_optin_idx
  on public.farmers (whatsapp_consent, whatsapp_opted_out_at)
  where whatsapp_consent is true;

alter table public.whatsapp_broadcasts enable row level security;
alter table public.whatsapp_message_events enable row level security;

-- No browser role may read or write contact lists, broadcasts, or message events.
revoke all on public.whatsapp_broadcasts from public, anon, authenticated;
revoke all on public.whatsapp_message_events from public, anon, authenticated;
grant all on public.whatsapp_broadcasts to service_role;
grant all on public.whatsapp_message_events to service_role;

commit;
