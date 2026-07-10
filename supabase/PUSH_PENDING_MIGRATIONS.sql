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


-- =============================================================================
-- Migration: 0048_punch_type_in_out_resolve.sql
-- =============================================================================

-- Fix IN/OUT resolution: single OUT punch must not appear as first_in (MIN punch_at bug).

CREATE OR REPLACE FUNCTION public.recompute_attendance_for_employee(
  p_employee_id uuid,
  p_date date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
  v_company_tz text;
  v_shift_id uuid;
  v_shift_start time;
  v_shift_end time;
  v_break_minutes integer;
  v_grace_late integer;
  v_grace_early integer;
  v_is_night boolean;
  v_weekly_off text[];
  v_weekday text;
  v_is_holiday boolean;
  v_is_weekly_off boolean;
  v_first_in timestamptz;
  v_last_out timestamptz;
  v_punch_count integer;
  v_single_type text;
  v_single_at timestamptz;
  v_metrics record;
  v_status text;
  v_worked integer;
  v_late integer;
BEGIN
  SELECT e.company_id, COALESCE(c.timezone, 'Asia/Karachi')
  INTO v_company_id, v_company_tz
  FROM public.employees e
  JOIN public.companies c ON c.id = e.company_id
  WHERE e.id = p_employee_id;

  IF v_company_id IS NULL THEN
    RETURN;
  END IF;

  SELECT esa.shift_id, s.start_time, s.end_time, s.break_minutes,
         s.grace_late_minutes, s.grace_early_minutes, s.is_night, esa.weekly_off
  INTO v_shift_id, v_shift_start, v_shift_end, v_break_minutes,
       v_grace_late, v_grace_early, v_is_night, v_weekly_off
  FROM public.employee_shift_assignments esa
  JOIN public.shifts s ON s.id = esa.shift_id
  WHERE esa.employee_id = p_employee_id
    AND esa.effective_from <= p_date
    AND (esa.effective_to IS NULL OR esa.effective_to >= p_date)
  ORDER BY esa.effective_from DESC
  LIMIT 1;

  v_shift_start := COALESCE(v_shift_start, time '09:00');
  v_shift_end := COALESCE(v_shift_end, time '17:00');
  v_break_minutes := COALESCE(v_break_minutes, 0);
  v_grace_late := COALESCE(v_grace_late, 15);
  v_grace_early := COALESCE(v_grace_early, 15);
  v_is_night := COALESCE(v_is_night, false);

  v_weekday := (ARRAY['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'])[EXTRACT(DOW FROM p_date)::int + 1];
  v_is_weekly_off := COALESCE(v_weekly_off, ARRAY[]::text[]) @> ARRAY[v_weekday];

  SELECT EXISTS (
    SELECT 1 FROM public.holidays h
    WHERE h.company_id = v_company_id
      AND h.holiday_date = p_date
      AND h.is_active = true
      AND h.branch_id IS NULL
  ) INTO v_is_holiday;

  v_first_in := NULL;
  v_last_out := NULL;

  SELECT COUNT(*)::integer
  INTO v_punch_count
  FROM public.attendance_punches p
  WHERE p.employee_id = p_employee_id
    AND p.company_id = v_company_id
    AND (p.punch_at AT TIME ZONE v_company_tz)::date = p_date;

  IF v_punch_count = 1 THEN
    SELECT p.punch_at, p.punch_type
    INTO v_single_at, v_single_type
    FROM public.attendance_punches p
    WHERE p.employee_id = p_employee_id
      AND p.company_id = v_company_id
      AND (p.punch_at AT TIME ZONE v_company_tz)::date = p_date
    LIMIT 1;

    IF v_single_type = 'out' THEN
      v_last_out := v_single_at;
    ELSE
      v_first_in := v_single_at;
    END IF;
  ELSIF v_punch_count > 1 THEN
    SELECT MIN(p.punch_at)
    INTO v_first_in
    FROM public.attendance_punches p
    WHERE p.employee_id = p_employee_id
      AND p.company_id = v_company_id
      AND (p.punch_at AT TIME ZONE v_company_tz)::date = p_date
      AND p.punch_type = 'in';

    IF v_first_in IS NULL THEN
      SELECT MIN(p.punch_at)
      INTO v_first_in
      FROM public.attendance_punches p
      WHERE p.employee_id = p_employee_id
        AND p.company_id = v_company_id
        AND (p.punch_at AT TIME ZONE v_company_tz)::date = p_date
        AND p.punch_type = 'auto';
    END IF;

    SELECT MAX(p.punch_at)
    INTO v_last_out
    FROM public.attendance_punches p
    WHERE p.employee_id = p_employee_id
      AND p.company_id = v_company_id
      AND (p.punch_at AT TIME ZONE v_company_tz)::date = p_date
      AND p.punch_type = 'out';

    IF v_last_out IS NULL AND v_first_in IS NOT NULL THEN
      SELECT MAX(p.punch_at)
      INTO v_last_out
      FROM public.attendance_punches p
      WHERE p.employee_id = p_employee_id
        AND p.company_id = v_company_id
        AND (p.punch_at AT TIME ZONE v_company_tz)::date = p_date
        AND p.punch_at > v_first_in;
    END IF;

    IF v_first_in IS NULL THEN
      SELECT MAX(p.punch_at)
      INTO v_last_out
      FROM public.attendance_punches p
      WHERE p.employee_id = p_employee_id
        AND p.company_id = v_company_id
        AND (p.punch_at AT TIME ZONE v_company_tz)::date = p_date
        AND p.punch_type = 'out';
    END IF;
  END IF;

  SELECT * INTO v_metrics FROM public.compute_attendance_metrics(
    p_date,
    v_first_in,
    v_last_out,
    v_shift_start,
    v_shift_end,
    v_break_minutes,
    v_grace_late,
    v_grace_early,
    v_is_night,
    v_company_tz,
    NULL,
    NULL
  );

  v_worked := v_metrics.worked_minutes;
  v_late := v_metrics.late_minutes;

  IF v_shift_id IS NOT NULL THEN
    v_expected_worked := (EXTRACT(EPOCH FROM (v_metrics.scheduled_end - v_metrics.scheduled_start)) / 60)::integer - v_break_minutes;
    v_present_threshold := LEAST(v_expected_worked, GREATEST(180, (v_expected_worked * 0.8)::integer));
  ELSE
    v_present_threshold := 240;
  END IF;

  IF v_is_holiday THEN
    v_status := 'Holiday';
  ELSIF v_is_weekly_off THEN
    v_status := 'Weekly Off';
  ELSIF v_punch_count = 0 THEN
    v_status := 'Absent';
  ELSIF v_worked >= v_present_threshold AND v_late > 0 THEN
    v_status := 'Late';
  ELSIF v_worked >= v_present_threshold THEN
    v_status := 'Present';
  ELSIF v_worked > 0 THEN
    v_status := 'Half Day';
  ELSE
    v_status := 'Absent';
  END IF;

  INSERT INTO public.attendance_daily (
    company_id, employee_id, attendance_date, shift_id,
    scheduled_start, scheduled_end, first_in, last_out,
    worked_minutes, late_minutes, early_out_minutes, overtime_minutes,
    status, is_weekly_off, is_holiday, updated_at
  ) VALUES (
    v_company_id, p_employee_id, p_date, v_shift_id,
    v_metrics.scheduled_start, v_metrics.scheduled_end,
    v_first_in, v_last_out,
    v_metrics.worked_minutes, v_metrics.late_minutes,
    v_metrics.early_out_minutes, v_metrics.overtime_minutes,
    v_status, v_is_weekly_off, v_is_holiday, now()
  )
  ON CONFLICT (employee_id, attendance_date) DO UPDATE SET
    shift_id = EXCLUDED.shift_id,
    scheduled_start = EXCLUDED.scheduled_start,
    scheduled_end = EXCLUDED.scheduled_end,
    first_in = EXCLUDED.first_in,
    last_out = EXCLUDED.last_out,
    worked_minutes = EXCLUDED.worked_minutes,
    late_minutes = EXCLUDED.late_minutes,
    early_out_minutes = EXCLUDED.early_out_minutes,
    overtime_minutes = EXCLUDED.overtime_minutes,
    status = CASE
      WHEN attendance_daily.status = 'Leave' THEN attendance_daily.status
      ELSE EXCLUDED.status
    END,
    is_weekly_off = EXCLUDED.is_weekly_off,
    is_holiday = EXCLUDED.is_holiday,
    updated_at = now();

  PERFORM public.sync_overtime_request_from_attendance(
    v_company_id,
    p_employee_id,
    p_date,
    v_metrics.overtime_minutes,
    v_first_in,
    v_last_out,
    v_is_holiday,
    v_is_weekly_off,
    v_company_tz
  );
END;
$$;


-- =============================================================================
-- Migration: 0049_shift_aware_in_out.sql
-- =============================================================================

-- Classify ambiguous punches using employee shift start/end windows.

CREATE OR REPLACE FUNCTION public.classify_punch_role(
  p_punch_at timestamptz,
  p_punch_type text,
  p_shift_start time,
  p_shift_end time,
  p_is_night boolean,
  p_timezone text
)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_tz text := COALESCE(NULLIF(trim(p_timezone), ''), 'Asia/Karachi');
  v_punch_min numeric;
  v_start_min numeric;
  v_end_min numeric;
  v_dist_start numeric;
  v_dist_end numeric;
BEGIN
  IF p_punch_type = 'in' THEN
    RETURN 'in';
  END IF;
  IF p_punch_type = 'out' THEN
    RETURN 'out';
  END IF;

  v_punch_min := EXTRACT(EPOCH FROM ((p_punch_at AT TIME ZONE v_tz)::time)) / 60.0;
  v_start_min := EXTRACT(EPOCH FROM p_shift_start) / 60.0;
  v_end_min := EXTRACT(EPOCH FROM p_shift_end) / 60.0;

  IF COALESCE(p_is_night, false) AND v_end_min <= v_start_min THEN
    IF v_punch_min < v_start_min AND v_punch_min <= v_end_min THEN
      v_punch_min := v_punch_min + 24 * 60;
    END IF;
    v_end_min := v_end_min + 24 * 60;
    IF v_punch_min < (v_start_min + v_end_min) / 2.0 THEN
      RETURN 'in';
    END IF;
    RETURN 'out';
  END IF;

  v_dist_start := ABS(v_punch_min - v_start_min);
  v_dist_end := ABS(v_punch_min - v_end_min);

  IF v_dist_start = v_dist_end THEN
    IF v_punch_min < (v_start_min + v_end_min) / 2.0 THEN
      RETURN 'in';
    END IF;
    RETURN 'out';
  END IF;

  IF v_dist_start < v_dist_end THEN
    RETURN 'in';
  END IF;
  RETURN 'out';
END;
$$;

CREATE OR REPLACE FUNCTION public.recompute_attendance_for_employee(
  p_employee_id uuid,
  p_date date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
  v_company_tz text;
  v_shift_id uuid;
  v_shift_start time;
  v_shift_end time;
  v_break_minutes integer;
  v_grace_late integer;
  v_grace_early integer;
  v_is_night boolean;
  v_weekly_off text[];
  v_weekday text;
  v_is_holiday boolean;
  v_is_weekly_off boolean;
  v_first_in timestamptz;
  v_last_out timestamptz;
  v_punch_count integer;
  v_metrics record;
  v_status text;
  v_worked integer;
  v_late integer;
BEGIN
  SELECT e.company_id, COALESCE(c.timezone, 'Asia/Karachi')
  INTO v_company_id, v_company_tz
  FROM public.employees e
  JOIN public.companies c ON c.id = e.company_id
  WHERE e.id = p_employee_id;

  IF v_company_id IS NULL THEN
    RETURN;
  END IF;

  SELECT esa.shift_id, s.start_time, s.end_time, s.break_minutes,
         s.grace_late_minutes, s.grace_early_minutes, s.is_night, esa.weekly_off
  INTO v_shift_id, v_shift_start, v_shift_end, v_break_minutes,
       v_grace_late, v_grace_early, v_is_night, v_weekly_off
  FROM public.employee_shift_assignments esa
  JOIN public.shifts s ON s.id = esa.shift_id
  WHERE esa.employee_id = p_employee_id
    AND esa.effective_from <= p_date
    AND (esa.effective_to IS NULL OR esa.effective_to >= p_date)
  ORDER BY esa.effective_from DESC
  LIMIT 1;

  v_shift_start := COALESCE(v_shift_start, time '09:00');
  v_shift_end := COALESCE(v_shift_end, time '17:00');
  v_break_minutes := COALESCE(v_break_minutes, 0);
  v_grace_late := COALESCE(v_grace_late, 15);
  v_grace_early := COALESCE(v_grace_early, 15);
  v_is_night := COALESCE(v_is_night, false);

  v_weekday := (ARRAY['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'])[EXTRACT(DOW FROM p_date)::int + 1];
  v_is_weekly_off := COALESCE(v_weekly_off, ARRAY[]::text[]) @> ARRAY[v_weekday];

  SELECT EXISTS (
    SELECT 1 FROM public.holidays h
    WHERE h.company_id = v_company_id
      AND h.holiday_date = p_date
      AND h.is_active = true
      AND h.branch_id IS NULL
  ) INTO v_is_holiday;

  SELECT COUNT(*)::integer
  INTO v_punch_count
  FROM public.attendance_punches p
  WHERE p.employee_id = p_employee_id
    AND p.company_id = v_company_id
    AND (p.punch_at AT TIME ZONE v_company_tz)::date = p_date;

  SELECT MIN(p.punch_at)
  INTO v_first_in
  FROM public.attendance_punches p
  WHERE p.employee_id = p_employee_id
    AND p.company_id = v_company_id
    AND (p.punch_at AT TIME ZONE v_company_tz)::date = p_date
    AND public.classify_punch_role(
      p.punch_at, p.punch_type, v_shift_start, v_shift_end, v_is_night, v_company_tz
    ) = 'in';

  SELECT MAX(p.punch_at)
  INTO v_last_out
  FROM public.attendance_punches p
  WHERE p.employee_id = p_employee_id
    AND p.company_id = v_company_id
    AND (p.punch_at AT TIME ZONE v_company_tz)::date = p_date
    AND public.classify_punch_role(
      p.punch_at, p.punch_type, v_shift_start, v_shift_end, v_is_night, v_company_tz
    ) = 'out';

  SELECT * INTO v_metrics FROM public.compute_attendance_metrics(
    p_date,
    v_first_in,
    v_last_out,
    v_shift_start,
    v_shift_end,
    v_break_minutes,
    v_grace_late,
    v_grace_early,
    v_is_night,
    v_company_tz,
    NULL,
    NULL
  );

  v_worked := v_metrics.worked_minutes;
  v_late := v_metrics.late_minutes;

  IF v_is_holiday THEN
    v_status := 'Holiday';
  ELSIF v_is_weekly_off THEN
    v_status := 'Weekly Off';
  ELSIF v_punch_count = 0 THEN
    v_status := 'Absent';
  ELSIF v_worked >= (CASE WHEN v_shift_id IS NOT NULL THEN 360 ELSE 240 END) AND v_late > 0 THEN
    v_status := 'Late';
  ELSIF v_worked >= (CASE WHEN v_shift_id IS NOT NULL THEN 360 ELSE 240 END) THEN
    v_status := 'Present';
  ELSIF v_worked > 0 THEN
    v_status := 'Half Day';
  ELSE
    v_status := 'Absent';
  END IF;

  INSERT INTO public.attendance_daily (
    company_id, employee_id, attendance_date, shift_id,
    scheduled_start, scheduled_end, first_in, last_out,
    worked_minutes, late_minutes, early_out_minutes, overtime_minutes,
    status, is_weekly_off, is_holiday, updated_at
  ) VALUES (
    v_company_id, p_employee_id, p_date, v_shift_id,
    v_metrics.scheduled_start, v_metrics.scheduled_end,
    v_first_in, v_last_out,
    v_metrics.worked_minutes, v_metrics.late_minutes,
    v_metrics.early_out_minutes, v_metrics.overtime_minutes,
    v_status, v_is_weekly_off, v_is_holiday, now()
  )
  ON CONFLICT (employee_id, attendance_date) DO UPDATE SET
    shift_id = EXCLUDED.shift_id,
    scheduled_start = EXCLUDED.scheduled_start,
    scheduled_end = EXCLUDED.scheduled_end,
    first_in = EXCLUDED.first_in,
    last_out = EXCLUDED.last_out,
    worked_minutes = EXCLUDED.worked_minutes,
    late_minutes = EXCLUDED.late_minutes,
    early_out_minutes = EXCLUDED.early_out_minutes,
    overtime_minutes = EXCLUDED.overtime_minutes,
    status = CASE
      WHEN attendance_daily.status = 'Leave' THEN attendance_daily.status
      ELSE EXCLUDED.status
    END,
    is_weekly_off = EXCLUDED.is_weekly_off,
    is_holiday = EXCLUDED.is_holiday,
    updated_at = now();

  PERFORM public.sync_overtime_request_from_attendance(
    v_company_id,
    p_employee_id,
    p_date,
    v_metrics.overtime_minutes,
    v_first_in,
    v_last_out,
    v_is_holiday,
    v_is_weekly_off,
    v_company_tz
  );
END;
$$;


-- =============================================================================
-- Migration: 0050_ot_multipliers_from_settings.sql
-- =============================================================================

-- Company-configurable OT multipliers (stored in app_settings.settings.ot_multipliers).

CREATE OR REPLACE FUNCTION public.ot_multiplier_for_company(
  p_company_id uuid,
  p_ot_type text
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_settings jsonb;
  v_key text;
  v_val numeric;
BEGIN
  SELECT settings INTO v_settings
  FROM public.app_settings
  WHERE company_id = p_company_id;

  v_key := CASE p_ot_type
    WHEN 'HOLIDAY' THEN 'HOLIDAY'
    WHEN 'WEEKEND' THEN 'WEEKEND'
    WHEN 'NIGHT' THEN 'NIGHT'
    ELSE 'NORMAL'
  END;

  v_val := NULLIF(v_settings->'ot_multipliers'->>v_key, '')::numeric;

  RETURN COALESCE(v_val, CASE p_ot_type
    WHEN 'HOLIDAY' THEN 2.5
    WHEN 'WEEKEND' THEN 2.0
    WHEN 'NIGHT' THEN 2.0
    ELSE 1.0
  END);
END;
$$;

CREATE OR REPLACE FUNCTION public.save_ot_multipliers(p_multipliers jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid := public.current_user_company_id();
BEGIN
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'No company context';
  END IF;

  IF NOT (
    public.user_has_permission('settings.update')
    OR public.user_has_permission('overtime.config')
    OR public.user_has_permission('overtime.approve')
  ) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  UPDATE public.app_settings
  SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object('ot_multipliers', p_multipliers)
  WHERE company_id = v_company_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_ot_multipliers(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ot_multiplier_for_company(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.sync_overtime_request_from_attendance(
  p_company_id uuid,
  p_employee_id uuid,
  p_date date,
  p_overtime_minutes integer,
  p_first_in timestamptz,
  p_last_out timestamptz,
  p_is_holiday boolean,
  p_is_weekly_off boolean,
  p_timezone text DEFAULT 'Asia/Karachi'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_min_minutes constant integer := 15;
  v_existing record;
  v_hours numeric(6,2);
  v_ot_type text;
  v_multiplier numeric(4,2);
  v_basic numeric(14,2);
  v_hourly numeric(12,2);
  v_amount numeric(14,2);
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
  v_multiplier := public.ot_multiplier_for_company(p_company_id, v_ot_type);

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
  v_hourly := ROUND(
    v_basic / (
      EXTRACT(DAY FROM (date_trunc('month', p_date::timestamp) + interval '1 month' - interval '1 day'))::numeric
      * 8
    ),
    2
  );
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

  IF v_existing.id IS NOT NULL AND v_existing.status = 'CANCELLED' THEN
    UPDATE public.overtime_requests
    SET status = 'PENDING',
        planned_hours = v_hours,
        start_time = v_start,
        end_time = v_end,
        ot_type = v_ot_type,
        rate_multiplier = v_multiplier,
        hourly_rate = NULLIF(v_hourly, 0),
        amount = NULLIF(v_amount, 0),
        reason = 'Auto from real-time attendance (' || p_overtime_minutes || ' min OT)',
        decision_note = NULL,
        approved_by = NULL,
        approved_at = NULL,
        updated_at = now()
    WHERE id = v_existing.id;
    RETURN;
  END IF;

  INSERT INTO public.overtime_requests (
    company_id,
    ot_no,
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
    status,
    source
  ) VALUES (
    p_company_id,
    public.next_overtime_no(p_company_id),
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
    'PENDING',
    'attendance'
  );
END;
$$;


-- =============================================================================
-- Migration: 0051_employee_overtime_eligible.sql
-- =============================================================================

-- Per-employee flag: when false, auto overtime from attendance is not created.

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS overtime_eligible boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.employees.overtime_eligible IS
  'When false, sync_overtime_request_from_attendance skips this employee.';

CREATE OR REPLACE FUNCTION public.sync_overtime_request_from_attendance(
  p_company_id uuid,
  p_employee_id uuid,
  p_date date,
  p_overtime_minutes integer,
  p_first_in timestamptz,
  p_last_out timestamptz,
  p_is_holiday boolean,
  p_is_weekly_off boolean,
  p_timezone text DEFAULT 'Asia/Karachi'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_min_minutes constant integer := 15;
  v_ot_eligible boolean;
  v_existing record;
  v_hours numeric(6,2);
  v_ot_type text;
  v_multiplier numeric(4,2);
  v_basic numeric(14,2);
  v_hourly numeric(12,2);
  v_amount numeric(14,2);
  v_start time;
  v_end time;
  v_tz text := COALESCE(NULLIF(trim(p_timezone), ''), 'Asia/Karachi');
BEGIN
  SELECT COALESCE(e.overtime_eligible, true)
  INTO v_ot_eligible
  FROM public.employees e
  WHERE e.id = p_employee_id;

  SELECT id, status INTO v_existing
  FROM public.overtime_requests
  WHERE employee_id = p_employee_id
    AND ot_date = p_date
    AND source = 'attendance'
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT COALESCE(v_ot_eligible, true) THEN
    IF v_existing.id IS NOT NULL AND v_existing.status = 'PENDING' THEN
      UPDATE public.overtime_requests
      SET status = 'CANCELLED',
          decision_note = 'Auto-cancelled: employee not eligible for overtime',
          updated_at = now()
      WHERE id = v_existing.id;
    END IF;
    RETURN;
  END IF;

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
  v_multiplier := public.ot_multiplier_for_company(p_company_id, v_ot_type);

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
  v_hourly := ROUND(
    v_basic / (
      EXTRACT(DAY FROM (date_trunc('month', p_date::timestamp) + interval '1 month' - interval '1 day'))::numeric
      * 8
    ),
    2
  );
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

  IF v_existing.id IS NOT NULL AND v_existing.status = 'CANCELLED' THEN
    UPDATE public.overtime_requests
    SET status = 'PENDING',
        planned_hours = v_hours,
        start_time = v_start,
        end_time = v_end,
        ot_type = v_ot_type,
        rate_multiplier = v_multiplier,
        hourly_rate = NULLIF(v_hourly, 0),
        amount = NULLIF(v_amount, 0),
        reason = 'Auto from real-time attendance (' || p_overtime_minutes || ' min OT)',
        decision_note = NULL,
        approved_by = NULL,
        approved_at = NULL,
        updated_at = now()
    WHERE id = v_existing.id;
    RETURN;
  END IF;

  INSERT INTO public.overtime_requests (
    company_id,
    ot_no,
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
    status,
    source
  ) VALUES (
    p_company_id,
    public.next_overtime_no(p_company_id),
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
    'PENDING',
    'attendance'
  );
END;
$$;


-- =============================================================================
-- Migration: 0052_seed_payroll_defaults_if_missing.sql
-- =============================================================================

-- Re-seed payroll components and tax slabs when missing (e.g. after data reset).

INSERT INTO public.payroll_components (
  company_id, code, name, component_type, calc_method, calc_value,
  is_taxable, is_eobi_applicable, is_pf_applicable, is_system, is_active, sort_order
)
SELECT
  c.id, v.code, v.name, v.ctype, v.method, v.val,
  v.taxable, v.eobi, v.pf, true, true, v.so
FROM public.companies c
CROSS JOIN (VALUES
  ('BASIC',        'Basic salary',                'EARNING',         'FIXED',     0,    true,  true,  true,  10),
  ('HRA',          'House rent allowance',        'EARNING',         'FIXED',     0,    true,  false, false, 20),
  ('MED',          'Medical allowance',           'EARNING',         'FIXED',     0,    false, false, false, 30),
  ('CONV',         'Conveyance allowance',        'EARNING',         'FIXED',     0,    true,  false, false, 40),
  ('UTIL',         'Utilities allowance',         'EARNING',         'FIXED',     0,    true,  false, false, 50),
  ('OTH',          'Other allowances / incentive','EARNING',         'FIXED',     0,    true,  false, false, 60),
  ('OT',           'Overtime',                    'EARNING',         'FIXED',     0,    true,  false, false, 70),
  ('BONUS',        'Bonus / commission',          'EARNING',         'FIXED',     0,    true,  false, false, 80),
  ('LOP',          'Loss of pay (unpaid leave)',  'DEDUCTION',       'FIXED',     0,    false, false, false, 100),
  ('TAX',          'Income tax (PAYE)',           'DEDUCTION',       'FORMULA',   0,    false, false, false, 110),
  ('EOBI_E',       'EOBI employee contribution',  'DEDUCTION',       'FIXED',     370,  false, false, false, 120),
  ('PF_E',         'Provident fund (employee)',   'DEDUCTION',       'PCT_BASIC', 8.33, false, false, false, 130),
  ('ADV',          'Salary advance recovery',     'DEDUCTION',       'FIXED',     0,    false, false, false, 140),
  ('EOBI_R',       'EOBI employer contribution',  'EMPLOYER_CONTRIB','FIXED',     1500, false, false, false, 200),
  ('PF_R',         'Provident fund (employer)',   'EMPLOYER_CONTRIB','PCT_BASIC', 8.33, false, false, false, 210)
) AS v(code, name, ctype, method, val, taxable, eobi, pf, so)
WHERE NOT EXISTS (
  SELECT 1 FROM public.payroll_components pc
  WHERE pc.company_id = c.id AND pc.code = v.code
);

INSERT INTO public.tax_slabs (company_id, fy_label, applies_to, slab_from, slab_to, base_tax, rate_pct, sort_order)
SELECT
  c.id, '2025-26', 'SALARIED', v.slab_from, v.slab_to, v.base_tax, v.rate_pct, v.so
FROM public.companies c
CROSS JOIN (VALUES
  (0,         600000,   0,        0,    10),
  (600000,    1200000,  0,        1,    20),
  (1200000,   2200000,  6000,     11,   30),
  (2200000,   3200000,  116000,   23,   40),
  (3200000,   4100000,  346000,   30,   50),
  (4100000,   NULL,     616000,   35,   60)
) AS v(slab_from, slab_to, base_tax, rate_pct, so)
WHERE NOT EXISTS (
  SELECT 1 FROM public.tax_slabs ts
  WHERE ts.company_id = c.id AND ts.fy_label = '2025-26' AND ts.applies_to = 'SALARIED'
);


-- =============================================================================
-- Migration: 0053_payroll_period_delete_any_status.sql
-- =============================================================================

-- Allow deleting payroll periods in any status (payslips/runs cascade).
DROP POLICY IF EXISTS pp_delete ON public.payroll_periods;
CREATE POLICY pp_delete ON public.payroll_periods FOR DELETE TO authenticated
  USING (
    company_id = public.current_user_company_id()
    AND public.user_has_permission('payroll.run')
  );


-- =============================================================================
-- Migration: 0054_salary_allowance_enabled_flags.sql
-- =============================================================================

-- Per-allowance enable flags on compensation (control payslip line visibility).

ALTER TABLE public.employee_salary_history
  ADD COLUMN IF NOT EXISTS house_rent_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS medical_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS conveyance_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS utilities_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS other_allowances_enabled boolean NOT NULL DEFAULT false;

UPDATE public.employee_salary_history SET house_rent_enabled = true WHERE house_rent > 0;
UPDATE public.employee_salary_history SET medical_enabled = true WHERE medical > 0;
UPDATE public.employee_salary_history SET conveyance_enabled = true WHERE conveyance > 0;
UPDATE public.employee_salary_history SET utilities_enabled = true WHERE utilities > 0;
UPDATE public.employee_salary_history SET other_allowances_enabled = true WHERE other_allowances > 0;


-- =============================================================================
-- Migration: 0055_statutory_defaults_all_off.sql
-- =============================================================================

-- Statutory enrollment: all deductions off by default (opt-in per employee).
ALTER TABLE public.employee_statutory_enrollment
  ALTER COLUMN income_tax_enabled SET DEFAULT false;


-- =============================================================================
-- Migration: 0056_attendance_punches_serial_employee_name.sql
-- =============================================================================

-- Display-friendly columns for Supabase Table Editor / exports:
-- serial_no: 1, 2, 3… per insert order (by punch time)
-- employee_name: denormalized from employees.full_name (kept in sync via trigger)

ALTER TABLE public.attendance_punches
  ADD COLUMN IF NOT EXISTS serial_no bigint,
  ADD COLUMN IF NOT EXISTS employee_name text;

-- Backfill serial numbers in chronological order
WITH numbered AS (
  SELECT id, row_number() OVER (ORDER BY punch_at, created_at, id) AS rn
  FROM public.attendance_punches
)
UPDATE public.attendance_punches p
SET serial_no = n.rn
FROM numbered n
WHERE p.id = n.id
  AND p.serial_no IS NULL;

-- Backfill employee names
UPDATE public.attendance_punches p
SET employee_name = e.full_name
FROM public.employees e
WHERE e.id = p.employee_id
  AND (p.employee_name IS NULL OR p.employee_name = '');

ALTER TABLE public.attendance_punches
  ALTER COLUMN serial_no SET NOT NULL;

-- Identity for new rows (continues after backfill max)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'attendance_punches'
      AND a.attname = 'serial_no'
      AND a.attidentity <> ''
  ) THEN
    ALTER TABLE public.attendance_punches
      ALTER COLUMN serial_no ADD GENERATED BY DEFAULT AS IDENTITY;
  END IF;
END $$;

SELECT setval(
  pg_get_serial_sequence('public.attendance_punches', 'serial_no'),
  COALESCE((SELECT MAX(serial_no) FROM public.attendance_punches), 0) + 1,
  false
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_punches_serial_no
  ON public.attendance_punches (serial_no);

CREATE OR REPLACE FUNCTION public.attendance_punches_set_employee_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  SELECT e.full_name INTO NEW.employee_name
  FROM public.employees e
  WHERE e.id = NEW.employee_id;

  IF NEW.employee_name IS NULL THEN
    RAISE EXCEPTION 'Employee % not found for attendance punch', NEW.employee_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attendance_punches_employee_name ON public.attendance_punches;
CREATE TRIGGER trg_attendance_punches_employee_name
  BEFORE INSERT OR UPDATE OF employee_id ON public.attendance_punches
  FOR EACH ROW
  EXECUTE FUNCTION public.attendance_punches_set_employee_name();

-- Keep employee_name current when an employee is renamed
CREATE OR REPLACE FUNCTION public.employees_sync_punch_names()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.full_name IS DISTINCT FROM OLD.full_name THEN
    UPDATE public.attendance_punches
    SET employee_name = NEW.full_name
    WHERE employee_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_employees_sync_punch_names ON public.employees;
CREATE TRIGGER trg_employees_sync_punch_names
  AFTER UPDATE OF full_name ON public.employees
  FOR EACH ROW
  EXECUTE FUNCTION public.employees_sync_punch_names();

COMMENT ON COLUMN public.attendance_punches.serial_no IS 'Display row number (1, 2, 3…) assigned on insert.';
COMMENT ON COLUMN public.attendance_punches.employee_name IS 'Employee full name at punch time; synced from employees.full_name.';


-- =============================================================================
-- Migration: 0057_fix_last_out_fallback.sql
-- =============================================================================

-- Fix last_out resolution fallback when all punches are imported as check-ins (status = 0) from ZKTeco.
-- If no explicit OUT punch is classified, but there are multiple punches, treat the last punch of the day as the OUT punch.

CREATE OR REPLACE FUNCTION public.recompute_attendance_for_employee(
  p_employee_id uuid,
  p_date date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
  v_company_tz text;
  v_shift_id uuid;
  v_shift_start time;
  v_shift_end time;
  v_break_minutes integer;
  v_grace_late integer;
  v_grace_early integer;
  v_is_night boolean;
  v_weekly_off text[];
  v_weekday text;
  v_is_holiday boolean;
  v_is_weekly_off boolean;
  v_first_in timestamptz;
  v_last_out timestamptz;
  v_punch_count integer;
  v_metrics record;
  v_status text;
  v_worked integer;
  v_late integer;
  v_expected_worked integer;
  v_present_threshold integer;
BEGIN
  SELECT e.company_id, COALESCE(c.timezone, 'Asia/Karachi')
  INTO v_company_id, v_company_tz
  FROM public.employees e
  JOIN public.companies c ON c.id = e.company_id
  WHERE e.id = p_employee_id;

  IF v_company_id IS NULL THEN
    RETURN;
  END IF;

  SELECT esa.shift_id, s.start_time, s.end_time, s.break_minutes,
         s.grace_late_minutes, s.grace_early_minutes, s.is_night, esa.weekly_off
  INTO v_shift_id, v_shift_start, v_shift_end, v_break_minutes,
       v_grace_late, v_grace_early, v_is_night, v_weekly_off
  FROM public.employee_shift_assignments esa
  JOIN public.shifts s ON s.id = esa.shift_id
  WHERE esa.employee_id = p_employee_id
    AND esa.effective_from <= p_date
    AND (esa.effective_to IS NULL OR esa.effective_to >= p_date)
  ORDER BY esa.effective_from DESC
  LIMIT 1;

  v_shift_start := COALESCE(v_shift_start, time '09:00');
  v_shift_end := COALESCE(v_shift_end, time '17:00');
  v_break_minutes := COALESCE(v_break_minutes, 0);
  v_grace_late := COALESCE(v_grace_late, 15);
  v_grace_early := COALESCE(v_grace_early, 15);
  v_is_night := COALESCE(v_is_night, false);

  v_weekday := (ARRAY['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'])[EXTRACT(DOW FROM p_date)::int + 1];
  v_is_weekly_off := COALESCE(v_weekly_off, ARRAY[]::text[]) @> ARRAY[v_weekday];

  SELECT EXISTS (
    SELECT 1 FROM public.holidays h
    WHERE h.company_id = v_company_id
      AND h.holiday_date = p_date
      AND h.is_active = true
      AND h.branch_id IS NULL
  ) INTO v_is_holiday;

  SELECT COUNT(*)::integer
  INTO v_punch_count
  FROM public.attendance_punches p
  WHERE p.employee_id = p_employee_id
    AND p.company_id = v_company_id
    AND (p.punch_at AT TIME ZONE v_company_tz)::date = p_date;

  SELECT MIN(p.punch_at)
  INTO v_first_in
  FROM public.attendance_punches p
  WHERE p.employee_id = p_employee_id
    AND p.company_id = v_company_id
    AND (p.punch_at AT TIME ZONE v_company_tz)::date = p_date
    AND public.classify_punch_role(
      p.punch_at, p.punch_type, v_shift_start, v_shift_end, v_is_night, v_company_tz
    ) = 'in';

  SELECT MAX(p.punch_at)
  INTO v_last_out
  FROM public.attendance_punches p
  WHERE p.employee_id = p_employee_id
    AND p.company_id = v_company_id
    AND (p.punch_at AT TIME ZONE v_company_tz)::date = p_date
    AND public.classify_punch_role(
      p.punch_at, p.punch_type, v_shift_start, v_shift_end, v_is_night, v_company_tz
    ) = 'out';

  -- FALLBACK: If no explicit OUT punch is classified, but we have multiple punches and a first_in,
  -- treat the latest punch that is after first_in as the last_out.
  IF v_last_out IS NULL AND v_first_in IS NOT NULL THEN
    SELECT MAX(p.punch_at)
    INTO v_last_out
    FROM public.attendance_punches p
    WHERE p.employee_id = p_employee_id
      AND p.company_id = v_company_id
      AND (p.punch_at AT TIME ZONE v_company_tz)::date = p_date
      AND p.punch_at > v_first_in;
  END IF;

  SELECT * INTO v_metrics FROM public.compute_attendance_metrics(
    p_date,
    v_first_in,
    v_last_out,
    v_shift_start,
    v_shift_end,
    v_break_minutes,
    v_grace_late,
    v_grace_early,
    v_is_night,
    v_company_tz,
    NULL,
    NULL
  );

  v_worked := v_metrics.worked_minutes;
  v_late := v_metrics.late_minutes;

  IF v_is_holiday THEN
    v_status := 'Holiday';
  ELSIF v_is_weekly_off THEN
    v_status := 'Weekly Off';
  ELSIF v_punch_count = 0 THEN
    v_status := 'Absent';
  ELSIF v_worked >= (CASE WHEN v_shift_id IS NOT NULL THEN 360 ELSE 240 END) AND v_late > 0 THEN
    v_status := 'Late';
  ELSIF v_worked >= (CASE WHEN v_shift_id IS NOT NULL THEN 360 ELSE 240 END) THEN
    v_status := 'Present';
  ELSIF v_worked > 0 THEN
    v_status := 'Half Day';
  ELSE
    v_status := 'Absent';
  END IF;

  INSERT INTO public.attendance_daily (
    company_id, employee_id, attendance_date, shift_id,
    scheduled_start, scheduled_end, first_in, last_out,
    worked_minutes, late_minutes, early_out_minutes, overtime_minutes,
    status, is_weekly_off, is_holiday, updated_at
  ) VALUES (
    v_company_id, p_employee_id, p_date, v_shift_id,
    v_metrics.scheduled_start, v_metrics.scheduled_end,
    v_first_in, v_last_out,
    v_metrics.worked_minutes, v_metrics.late_minutes,
    v_metrics.early_out_minutes, v_metrics.overtime_minutes,
    v_status, v_is_weekly_off, v_is_holiday, now()
  )
  ON CONFLICT (employee_id, attendance_date) DO UPDATE SET
    shift_id = EXCLUDED.shift_id,
    scheduled_start = EXCLUDED.scheduled_start,
    scheduled_end = EXCLUDED.scheduled_end,
    first_in = EXCLUDED.first_in,
    last_out = EXCLUDED.last_out,
    worked_minutes = EXCLUDED.worked_minutes,
    late_minutes = EXCLUDED.late_minutes,
    early_out_minutes = EXCLUDED.early_out_minutes,
    overtime_minutes = EXCLUDED.overtime_minutes,
    status = CASE
      WHEN attendance_daily.status = 'Leave' THEN attendance_daily.status
      ELSE EXCLUDED.status
    END,
    is_weekly_off = EXCLUDED.is_weekly_off,
    is_holiday = EXCLUDED.is_holiday,
    updated_at = now();

  PERFORM public.sync_overtime_request_from_attendance(
    v_company_id,
    p_employee_id,
    p_date,
    v_metrics.overtime_minutes,
    v_first_in,
    v_last_out,
    v_is_holiday,
    v_is_weekly_off,
    v_company_tz
  );
END;
$$;
