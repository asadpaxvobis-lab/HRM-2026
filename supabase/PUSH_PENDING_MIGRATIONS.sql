-- =============================================================================
-- Apply pending migrations to project zxkkmwycimijvbpgqpfh (HRM-2026)
-- Dashboard: https://supabase.com/dashboard/project/zxkkmwycimijvbpgqpfh/sql/new
-- Or CLI:  supabase link --project-ref zxkkmwycimijvbpgqpfh
--         supabase db query -f supabase/PUSH_PENDING_MIGRATIONS.sql --linked
-- =============================================================================

-- 0035 (safe if already applied)
ALTER TABLE public.attendance_devices
  ADD COLUMN IF NOT EXISTS agent_last_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS agent_sync_notes text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_punches_zk_dedup
  ON public.attendance_punches (employee_id, punch_at)
  WHERE source IN ('zkteco', 'import');

-- 0036
CREATE TABLE IF NOT EXISTS public.employee_device_pins (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  device_id   uuid NOT NULL REFERENCES public.attendance_devices(id) ON DELETE CASCADE,
  device_pin  integer NOT NULL CHECK (device_pin > 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (device_id, device_pin),
  UNIQUE (employee_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_employee_device_pins_device ON public.employee_device_pins (device_id);
CREATE INDEX IF NOT EXISTS idx_employee_device_pins_employee ON public.employee_device_pins (employee_id);

ALTER TABLE public.attendance_devices
  ADD COLUMN IF NOT EXISTS agent_connect_ok boolean,
  ADD COLUMN IF NOT EXISTS agent_connect_checked_at timestamptz;

DROP INDEX IF EXISTS public.idx_employees_company_device_pin;

ALTER TABLE public.employee_device_pins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS employee_device_pins_select ON public.employee_device_pins;
CREATE POLICY employee_device_pins_select ON public.employee_device_pins
  FOR SELECT USING (company_id = public.current_user_company_id());

DROP POLICY IF EXISTS employee_device_pins_modify ON public.employee_device_pins;
CREATE POLICY employee_device_pins_modify ON public.employee_device_pins
  FOR ALL USING (
    company_id = public.current_user_company_id()
    AND (
      public.user_has_permission('employee.update')
      OR public.user_has_permission('employee.create')
      OR public.user_has_permission('attendance.device')
    )
  )
  WITH CHECK (company_id = public.current_user_company_id());

-- 0038
ALTER TABLE public.attendance_devices
  ADD COLUMN IF NOT EXISTS agent_lan_message text;

CREATE TABLE IF NOT EXISTS public.zkt_agent_heartbeat (
  company_id     uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  host_name      text,
  is_syncing     boolean NOT NULL DEFAULT false,
  cycle_summary  text,
  devices_online int NOT NULL DEFAULT 0,
  devices_total  int NOT NULL DEFAULT 0,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.zkt_agent_heartbeat ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS zkt_agent_heartbeat_select ON public.zkt_agent_heartbeat;
CREATE POLICY zkt_agent_heartbeat_select ON public.zkt_agent_heartbeat
  FOR SELECT TO authenticated
  USING (company_id = public.current_user_company_id());
