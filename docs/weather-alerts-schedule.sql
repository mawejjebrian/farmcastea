-- Run once in Supabase SQL Editor after creating the Vault secret
-- named farmcast_weather_alert_hmac_secret.
do $$
declare
  signing_secret text;
  job_id bigint;
begin
  select decrypted_secret into signing_secret
  from vault.decrypted_secrets
  where name = 'farmcast_weather_alert_hmac_secret'
  limit 1;

  if signing_secret is null or length(signing_secret) < 32 then
    raise exception 'Create a 32+ character farmcast_weather_alert_hmac_secret in Supabase Vault first.';
  end if;

  -- Replace any previous job with the same name to avoid duplicate sends.
  perform cron.unschedule(jobid)
  from cron.job
  where jobname in (
    'farmcast-weather-alerts-every-six-hours',
    'farmcast-weather-alerts-every-twelve-hours'
  );

  select cron.schedule(
    'farmcast-weather-alerts-every-twelve-hours',
    '0 */12 * * *',
    $job$
    do $inner$
    declare
      signing_secret text;
      timestamp_text text;
      payload jsonb := '{}'::jsonb;
      signature_text text;
    begin
      select decrypted_secret into signing_secret
      from vault.decrypted_secrets
      where name = 'farmcast_weather_alert_hmac_secret'
      limit 1;

      timestamp_text := extract(epoch from now())::bigint::text;
      signature_text := encode(
        extensions.hmac(timestamp_text || '.' || payload::text, signing_secret, 'sha256'),
        'hex'
      );

      perform net.http_post(
        url := 'https://farmcastea.vercel.app/api/weather-alerts',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-timestamp', timestamp_text,
          'x-signature', signature_text
        ),
        body := payload,
        timeout_milliseconds := 10000
      );
    end
    $inner$;
    $job$
  ) into job_id;
end
$$;
