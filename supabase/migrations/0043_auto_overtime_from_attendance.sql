-- Auto-create PENDING overtime_requests when real-time attendance detects overtime.

ALTER TABLE public.overtime_requests
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'attendance'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_ot_attendance_pending_day
  ON public.overtime_requests (employee_id, ot_date)
  WHERE source = 'attendance' AND status = 'PENDING';

CREATE OR REPLACE FUNCTION public.next_overtime_no(p_company_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_yr text := to_char(current_date, 'YYYY');
  v_last text;
  v_n integer := 1;
BEGIN
  SELECT ot_no INTO v_last
  FROM public.overtime_requests
  WHERE company_id = p_company_id
    AND ot_no LIKE 'OT-' || v_yr || '-%'
  ORDER BY ot_no DESC
  LIMIT 1;

  IF v_last IS NOT NULL THEN
    v_n := COALESCE((regexp_match(v_last, '(\d+)$'))[1]::integer, 0) + 1;
  END IF;

  RETURN 'OT-' || v_yr || '-' || lpad(v_n::text, 4, '0');
END;
$$;

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

-- Hook into attendance recompute (runs after every punch sync / agent pull)
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

  SELECT MIN(p.punch_at), MAX(p.punch_at), COUNT(*)::integer
  INTO v_first_in, v_last_out, v_punch_count
  FROM public.attendance_punches p
  WHERE p.employee_id = p_employee_id
    AND p.company_id = v_company_id
    AND (p.punch_at AT TIME ZONE v_company_tz)::date = p_date;

  IF v_punch_count <= 1 THEN
    v_last_out := NULL;
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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'overtime_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.overtime_requests;
  END IF;
END $$;
