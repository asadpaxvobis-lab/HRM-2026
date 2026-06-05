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
