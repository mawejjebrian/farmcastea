-- Enable Supabase's Postgres scheduler and asynchronous HTTP client.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
