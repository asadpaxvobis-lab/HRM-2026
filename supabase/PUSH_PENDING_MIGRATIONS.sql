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
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_ot_pay_context(
  p_employee_id uuid,
  p_ot_date date,
  p_planned_hours numeric DEFAULT 0,
  p_rate_multiplier numeric DEFAULT 1.0,
  p_exclude_request_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_basic numeric := 0;
  v_currency text := 'PKR';
  v_hourly numeric := 0;
  v_request_amount numeric := 0;
  v_month_hours numeric := 0;
  v_month_amount numeric := 0;
  v_month_start date;
  v_month_end date;
  v_month_days int;
  v_daily_hours numeric := 8;
  v_row record;
BEGIN
  IF p_employee_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'employee_id required');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.employees e
    INNER JOIN public.users u ON u.id = auth.uid()
    WHERE e.id = p_employee_id
      AND e.company_id = u.company_id
  ) THEN
    RAISE EXCEPTION 'Employee not found in your company';
  END IF;

  IF NOT (
    p_employee_id IN (
      SELECT u.employee_id FROM public.users u
      WHERE u.id = auth.uid() AND u.employee_id IS NOT NULL
    )
    OR public.user_has_permission('overtime.approve')
    OR public.user_has_permission('overtime.view')
    OR public.user_has_permission('payroll.view')
    OR public.user_has_permission('employee.update')
  ) THEN
    RAISE EXCEPTION 'Not authorized to view overtime pay for this employee';
  END IF;

  SELECT h.basic, h.currency
  INTO v_basic, v_currency
  FROM public.employee_salary_history h
  WHERE h.employee_id = p_employee_id
    AND h.effective_from <= p_ot_date
    AND (h.effective_to IS NULL OR h.effective_to >= p_ot_date)
  ORDER BY h.effective_from DESC
  LIMIT 1;

  IF v_basic IS NULL OR v_basic <= 0 THEN
    SELECT h.basic, h.currency
    INTO v_basic, v_currency
    FROM public.employee_salary_history h
    WHERE h.employee_id = p_employee_id
    ORDER BY h.effective_from DESC
    LIMIT 1;
  END IF;

  v_basic := COALESCE(v_basic, 0);
  v_currency := COALESCE(v_currency, 'PKR');
  v_month_days := EXTRACT(
    DAY FROM (date_trunc('month', p_ot_date::timestamp) + interval '1 month' - interval '1 day')
  )::int;
  v_hourly := ROUND(v_basic / (v_month_days * v_daily_hours)::numeric, 2);
  v_request_amount := ROUND(
    COALESCE(p_planned_hours, 0) * v_hourly * COALESCE(NULLIF(p_rate_multiplier, 0), 1.0),
    2
  );

  v_month_start := date_trunc('month', p_ot_date)::date;
  v_month_end := (date_trunc('month', p_ot_date) + interval '1 month' - interval '1 day')::date;

  FOR v_row IN
    SELECT
      COALESCE(r.actual_hours, r.planned_hours, 0) AS hrs,
      r.amount,
      r.hourly_rate,
      r.rate_multiplier
    FROM public.overtime_requests r
    WHERE r.employee_id = p_employee_id
      AND r.ot_date >= v_month_start
      AND r.ot_date <= v_month_end
      AND r.status IN ('PENDING', 'APPROVED', 'PAID')
      AND (p_exclude_request_id IS NULL OR r.id <> p_exclude_request_id)
  LOOP
    v_month_hours := v_month_hours + COALESCE(v_row.hrs, 0);
    IF v_row.amount IS NOT NULL AND v_row.amount > 0 THEN
      v_month_amount := v_month_amount + v_row.amount;
    ELSIF v_row.hourly_rate IS NOT NULL AND v_row.hourly_rate > 0 AND v_row.hrs > 0 THEN
      v_month_amount := v_month_amount + ROUND(
        v_row.hrs * v_row.hourly_rate * COALESCE(NULLIF(v_row.rate_multiplier, 0), 1.0),
        2
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'basic', v_basic,
    'currency', v_currency,
    'hourly_rate', v_hourly,
    'request_amount', v_request_amount,
    'month_hours', v_month_hours,
    'month_amount', v_month_amount,
    'month_total_hours', v_month_hours + COALESCE(p_planned_hours, 0),
    'month_total_amount', v_month_amount + v_request_amount
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_overtime_request_from_attendance(
  p_employee_id uuid,
  p_date date,
  p_overtime_minutes int,
  p_first_in timestamptz DEFAULT NULL,
  p_last_out timestamptz DEFAULT NULL,
  p_is_weekly_off boolean DEFAULT false,
  p_is_holiday boolean DEFAULT false,
  p_timezone text DEFAULT 'Asia/Karachi'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_min_minutes int := 30;
  v_existing record;
  v_hours numeric(6,2);
  v_ot_type text;
  v_multiplier numeric(4,2);
  v_basic numeric(14,2);
  v_hourly numeric(12,2);
  v_amount numeric(14,2);
  v_month_days int;
  v_daily_hours numeric := 8;
  v_start time;
  v_end time;
  v_tz text := COALESCE(NULLIF(trim(p_timezone), ''), 'Asia/Karachi');
BEGIN
  SELECT id, status INTO v_existing
  FROM public.overtime_requests
  WHERE employee_id = p_employee_id
    AND ot_date = p_date
    AND source = 'attendance'
  ORDER BY created_at DESC
  LIMIT 1;

  IF COALESCE(p_overtime_minutes, 0) < v_min_minutes THEN
    IF v_existing.id IS NOT NULL AND v_existing.status = 'PENDING' THEN
      UPDATE public.overtime_requests
      SET status = 'CANCELLED',
          decision_note = 'Auto-cancelled: overtime below minimum after attendance sync',
          updated_at = now()
      WHERE id = v_existing.id;
    END IF;
    RETURN;
  END IF;

  IF v_existing.id IS NOT NULL AND v_existing.status IN ('APPROVED', 'PAID', 'REJECTED') THEN
    RETURN;
  END IF;

  v_hours := ROUND(p_overtime_minutes / 60.0, 2);
  v_ot_type := CASE
    WHEN COALESCE(p_is_holiday, false) THEN 'HOLIDAY'
    WHEN COALESCE(p_is_weekly_off, false) THEN 'WEEKEND'
    ELSE 'NORMAL'
  END;
  v_multiplier := CASE v_ot_type
    WHEN 'HOLIDAY' THEN 2.5
    WHEN 'WEEKEND' THEN 2.0
    ELSE 1.0
  END;

  v_start := CASE WHEN p_first_in IS NOT NULL THEN (p_first_in AT TIME ZONE v_tz)::time ELSE NULL END;
  v_end := CASE WHEN p_last_out IS NOT NULL THEN (p_last_out AT TIME ZONE v_tz)::time ELSE NULL END;

  SELECT h.basic INTO v_basic
  FROM public.employee_salary_history h
  WHERE h.employee_id = p_employee_id
    AND h.effective_from <= p_date
    AND (h.effective_to IS NULL OR h.effective_to >= p_date)
  ORDER BY h.effective_from DESC
  LIMIT 1;

  IF v_basic IS NULL OR v_basic <= 0 THEN
    SELECT h.basic INTO v_basic
    FROM public.employee_salary_history h
    WHERE h.employee_id = p_employee_id
    ORDER BY h.effective_from DESC
    LIMIT 1;
  END IF;

  v_basic := COALESCE(v_basic, 0);
  v_month_days := EXTRACT(
    DAY FROM (date_trunc('month', p_date::timestamp) + interval '1 month' - interval '1 day')
  )::int;
  v_hourly := ROUND(v_basic / (v_month_days * v_daily_hours)::numeric, 2);
  v_amount := ROUND(v_hours * v_hourly * v_multiplier, 2);

  IF v_existing.id IS NOT NULL AND v_existing.status = 'PENDING' THEN
    UPDATE public.overtime_requests
    SET planned_hours = v_hours,
        start_time = v_start,
        end_time = v_end,
        ot_type = v_ot_type,
        rate_multiplier = v_multiplier,
        hourly_rate = NULLIF(v_hourly, 0),
        amount = NULLIF(v_amount, 0),
        reason = 'Auto from real-time attendance (' || p_overtime_minutes || ' min OT)',
        updated_at = now()
    WHERE id = v_existing.id;
    RETURN;
  END IF;

  IF v_existing.id IS NOT NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.overtime_requests (
    employee_id,
    ot_date,
    start_time,
    end_time,
    planned_hours,
    ot_type,
    rate_multiplier,
    hourly_rate,
    amount,
    reason,
    source,
    status
  )
  VALUES (
    p_employee_id,
    p_date,
    v_start,
    v_end,
    v_hours,
    v_ot_type,
    v_multiplier,
    NULLIF(v_hourly, 0),
    NULLIF(v_amount, 0),
    'Auto from real-time attendance (' || p_overtime_minutes || ' min OT)',
    'attendance',
    'PENDING'
  );
END;
$$;

UPDATE public.overtime_requests r
SET rate_multiplier = 1.0
WHERE r.status = 'PENDING'
  AND r.ot_type = 'NORMAL'
  AND COALESCE(r.rate_multiplier, 1.5) >= 1.5;

UPDATE public.overtime_requests r
SET
  hourly_rate = calc.hourly,
  amount = calc.amount
FROM (
  SELECT
    o.id,
    ROUND(
      COALESCE(sal.basic, 0) / (
        EXTRACT(
          DAY FROM (date_trunc('month', o.ot_date::timestamp) + interval '1 month' - interval '1 day')
        )::numeric * 8
      ),
      2
    ) AS hourly,
    ROUND(
      o.planned_hours
      * ROUND(
          COALESCE(sal.basic, 0) / (
            EXTRACT(
              DAY FROM (date_trunc('month', o.ot_date::timestamp) + interval '1 month' - interval '1 day')
            )::numeric * 8
          ),
          2
        )
      * COALESCE(NULLIF(o.rate_multiplier, 0), 1.0),
      2
    ) AS amount
  FROM public.overtime_requests o
  LEFT JOIN LATERAL (
    SELECT h.basic
    FROM public.employee_salary_history h
    WHERE h.employee_id = o.employee_id
      AND h.effective_from <= o.ot_date
      AND (h.effective_to IS NULL OR h.effective_to >= o.ot_date)
    ORDER BY h.effective_from DESC
    LIMIT 1
  ) sal ON true
  WHERE o.status = 'PENDING'
) calc
WHERE r.id = calc.id
  AND calc.hourly > 0;

NOTIFY pgrst, 'reload schema';
