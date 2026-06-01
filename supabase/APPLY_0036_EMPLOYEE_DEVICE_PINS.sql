-- Run in Supabase SQL Editor: https://supabase.com/dashboard/project/zxkkmwycimijvbpgqpfh/sql/new

-- Per-device ZKTeco PIN mapping (same PIN number can exist on different machines for different employees)

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

CREATE POLICY employee_device_pins_select ON public.employee_device_pins
  FOR SELECT USING (company_id = public.current_user_company_id());

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
