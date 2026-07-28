-- Herstel van wat de backup-restore stil is kwijtgeraakt.
--
-- De migratie van het oude Supabase-project (kkxfvkthoslrratzxjeg) naar het huidige is gemaakt
-- via de REST-API. De bijbehorende gids zegt het zelf:
--
--   "This backup includes all tables and their data. If you had custom SQL views, functions, or
--    triggers in your original project, you will need to recreate those manually, as the REST
--    API only exposes table structures and data."
--
-- Nagekeken tegen de nieuwe database: de vier tabellen staan er, hun updated_at-triggers en de
-- vier functies erachter niet. Er ging daardoor niets kapot — en dat is precies het probleem.
-- `updated_at` blijft voor eeuwig op de aanmaakdatum staan, en dat merk je pas als je op dat
-- veld gaat sorteren of filteren.
--
-- De view blended_account_monthly heeft de restore wel overleefd, en app_role() ook.
-- Triggers: 0 van de 4 aanwezig voor deze reparatie.
--
-- Idempotent; veilig om meerdere keren te draaien.

-- ── client_reports ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_client_reports_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_client_reports_updated_at ON client_reports;
CREATE TRIGGER trg_client_reports_updated_at
  BEFORE UPDATE ON client_reports
  FOR EACH ROW
  EXECUTE FUNCTION update_client_reports_updated_at();

-- ── generation_jobs ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_generation_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_generation_jobs_updated_at ON generation_jobs;
CREATE TRIGGER trg_generation_jobs_updated_at
  BEFORE UPDATE ON generation_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_generation_jobs_updated_at();

-- ── generation_job_events ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_generation_job_events_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_generation_job_events_updated_at ON generation_job_events;
CREATE TRIGGER trg_generation_job_events_updated_at
  BEFORE UPDATE ON generation_job_events
  FOR EACH ROW
  EXECUTE FUNCTION update_generation_job_events_updated_at();

-- ── merchant_product_snapshots ─────────────────────────────────────────────
-- Deze gebruikt een gedeelde functie in plaats van een eigen; die was ook weg.

CREATE OR REPLACE FUNCTION public.set_timestamp_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS merchant_product_snapshots_set_updated_at ON public.merchant_product_snapshots;
CREATE TRIGGER merchant_product_snapshots_set_updated_at
  BEFORE UPDATE ON public.merchant_product_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION public.set_timestamp_updated_at();
