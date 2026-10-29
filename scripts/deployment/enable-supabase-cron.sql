-- Execute somente após configurar o servidor e aprovar a publicação.
-- Ative pg_cron e pg_net no painel Supabase antes de executar.
-- No Vault, crie radar_cron_secret com o MESMO valor de CRON_SECRET da Vercel.
-- Nunca escreva esse valor neste arquivo, no Git ou em uma consulta compartilhada.
DO $radar$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
    OR NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE EXCEPTION 'Ative pg_cron e pg_net antes de agendar';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'radar_cron_secret' AND length(decrypted_secret) >= 32) THEN
    RAISE EXCEPTION 'Configure radar_cron_secret no Vault antes de agendar';
  END IF;
  PERFORM cron.schedule(
    'radar-ingestion',
    '*/5 * * * *',
    $job$
      SELECT net.http_post(
        url := 'https://signal-watch-ten.vercel.app/api/cron/ingest',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || decrypted_secret),
        body := '{}'::jsonb,
        timeout_milliseconds := 250000
      ) FROM vault.decrypted_secrets
      WHERE name = 'radar_cron_secret' AND length(decrypted_secret) >= 32;
    $job$
  );
END $radar$;

-- Conferência (não retorna credenciais):
SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'radar-ingestion';
-- Pausar: SELECT cron.alter_job(jobid, active := false) FROM cron.job WHERE jobname = 'radar-ingestion';
-- Conferir HTTP posteriormente: SELECT id, status_code, timed_out, error_msg, created FROM net._http_response ORDER BY created DESC LIMIT 10;
