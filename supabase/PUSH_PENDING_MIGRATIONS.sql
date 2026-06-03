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

-- 0044 — loan give + approver routing (fixes approver_id column error)
ALTER TABLE public.loans
  ADD COLUMN IF NOT EXISTS approver_id uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS requested_by uuid REFERENCES public.users(id);

CREATE INDEX IF NOT EXISTS idx_loans_approver_pending
  ON public.loans(approver_id)
  WHERE status = 'REQUESTED';

DROP POLICY IF EXISTS loan_select ON public.loans;
CREATE POLICY loan_select ON public.loans FOR SELECT TO authenticated
  USING (
    public.user_has_permission('loan.view')
    OR public.user_has_permission('loan.approve')
    OR approver_id = auth.uid()
    OR employee_id IN (SELECT employee_id FROM public.users WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS loan_insert ON public.loans;
CREATE POLICY loan_insert ON public.loans FOR INSERT TO authenticated
  WITH CHECK (
    company_id = public.current_user_company_id()
    AND (
      (
        public.user_has_permission('loan.create')
        AND employee_id IN (
          SELECT u.employee_id FROM public.users u
          WHERE u.id = auth.uid() AND u.employee_id IS NOT NULL
        )
      )
      OR (
        public.user_has_permission('loan.approve')
        AND EXISTS (
          SELECT 1 FROM public.employees e
          WHERE e.id = employee_id
            AND e.company_id = public.current_user_company_id()
        )
      )
    )
    AND approver_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.users au
      WHERE au.id = approver_id
        AND au.company_id = public.current_user_company_id()
        AND au.status = 'Active'
    )
  );

DROP POLICY IF EXISTS loan_update ON public.loans;
CREATE POLICY loan_update ON public.loans FOR UPDATE TO authenticated
  USING (
    (
      employee_id IN (SELECT employee_id FROM public.users WHERE id = auth.uid())
      AND status = 'REQUESTED'
    )
    OR approver_id = auth.uid()
    OR public.user_has_permission('loan.approve')
    OR public.user_has_permission('loan.update')
  )
  WITH CHECK (
    (
      employee_id IN (SELECT employee_id FROM public.users WHERE id = auth.uid())
      AND status IN ('REQUESTED', 'CANCELLED')
    )
    OR approver_id = auth.uid()
    OR public.user_has_permission('loan.approve')
    OR public.user_has_permission('loan.update')
  );

-- Assigned approver can post installment schedule on approve/disburse
DROP POLICY IF EXISTS li_insert ON public.loan_installments;
CREATE POLICY li_insert ON public.loan_installments FOR INSERT TO authenticated
  WITH CHECK (
    public.user_has_permission('loan.approve')
    OR public.user_has_permission('loan.update')
    OR EXISTS (
      SELECT 1 FROM public.loans l
      WHERE l.id = loan_installments.loan_id
        AND l.approver_id = auth.uid()
    )
  );

NOTIFY pgrst, 'reload schema';

-- 0046 — overtime approval routing (Over Time Approval page)
ALTER TABLE public.overtime_requests
  ADD COLUMN IF NOT EXISTS approver_id uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS requested_by uuid REFERENCES public.users(id);

CREATE INDEX IF NOT EXISTS idx_ot_approver_pending
  ON public.overtime_requests(approver_id)
  WHERE status = 'PENDING';

DROP POLICY IF EXISTS ot_select ON public.overtime_requests;
CREATE POLICY ot_select ON public.overtime_requests FOR SELECT TO authenticated
  USING (
    public.user_has_permission('overtime.view')
    OR public.user_has_permission('overtime.approve')
    OR approver_id = auth.uid()
    OR employee_id IN (SELECT employee_id FROM public.users WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS ot_update ON public.overtime_requests;
CREATE POLICY ot_update ON public.overtime_requests FOR UPDATE TO authenticated
  USING (
    (employee_id IN (SELECT employee_id FROM public.users WHERE id = auth.uid()) AND status = 'PENDING')
    OR approver_id = auth.uid()
    OR public.user_has_permission('overtime.approve')
    OR public.user_has_permission('overtime.config')
  )
  WITH CHECK (
    employee_id IN (SELECT employee_id FROM public.users WHERE id = auth.uid())
    OR approver_id = auth.uid()
    OR public.user_has_permission('overtime.approve')
    OR public.user_has_permission('overtime.config')
  );

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- 0047 — OT pay formula (salary ÷ month days × 8 × OT hours × multiplier)
-- Paste & run entire file in SQL Editor:
--   supabase/APPLY_0047_OT_PAY_SALARY_FORMULA.sql
-- Updates get_ot_pay_context, sync_overtime_request_from_attendance,
-- and recalculates all PENDING overtime amounts.
-- =============================================================================
