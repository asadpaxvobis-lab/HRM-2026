-- Per-device ZKT LAN fetch runs + punch-level skip/insert audit (live testing)

CREATE TABLE IF NOT EXISTS public.zkt_device_fetch_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  device_id        uuid NOT NULL REFERENCES public.attendance_devices(id) ON DELETE CASCADE,
  started_at       timestamptz NOT NULL,
  finished_at      timestamptz NOT NULL,
  success          boolean NOT NULL DEFAULT false,
  since_cursor     timestamptz,
  logs_read        int NOT NULL DEFAULT 0,
  excluded_before_cursor int NOT NULL DEFAULT 0,
  mapped_count     int NOT NULL DEFAULT 0,
  inserted_count   int NOT NULL DEFAULT 0,
  duplicate_count  int NOT NULL DEFAULT 0,
  skipped_count    int NOT NULL DEFAULT 0,
  summary          text,
  error_message    text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zkt_fetch_runs_device_started
  ON public.zkt_device_fetch_runs (device_id, started_at DESC);

CREATE TABLE IF NOT EXISTS public.zkt_fetch_log_entries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id       uuid NOT NULL REFERENCES public.zkt_device_fetch_runs(id) ON DELETE CASCADE,
  device_pin   int,
  punch_at     timestamptz,
  outcome      text NOT NULL,
  reason       text NOT NULL,
  employee_id  uuid REFERENCES public.employees(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_zkt_fetch_entries_run
  ON public.zkt_fetch_log_entries (run_id);

COMMENT ON TABLE public.zkt_device_fetch_runs IS 'One row per Hrm.ZktAgent pull from a ZKTeco device';
COMMENT ON TABLE public.zkt_fetch_log_entries IS 'Punch-level outcomes: unmapped_pin, duplicate, capped, before_cursor, inserted';

ALTER TABLE public.zkt_device_fetch_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zkt_fetch_log_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY zkt_fetch_runs_select ON public.zkt_device_fetch_runs
  FOR SELECT TO authenticated
  USING (company_id = public.current_user_company_id());

CREATE POLICY zkt_fetch_entries_select ON public.zkt_fetch_log_entries
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.zkt_device_fetch_runs r
      WHERE r.id = run_id AND r.company_id = public.current_user_company_id()
    )
  );
