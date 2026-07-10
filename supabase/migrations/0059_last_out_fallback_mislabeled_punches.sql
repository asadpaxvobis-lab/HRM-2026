-- Devices sometimes mislabel the evening checkout punch as 'in' (seen from 6 Jul 2026 on ZKTeco).
-- classify_punch_role trusts the device label, so no 'out' is found and the day computes as Absent
-- even though the employee worked a full day. Add the same fallback the web app already uses:
-- if there is a first_in but no classified out, take the latest punch of the day that is at
-- least 60 minutes after first_in as the checkout.

CREATE OR REPLACE FUNCTION public.recompute_attendance_for_employee(p_employee_id uuid, p_date date)
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

  -- Fallback for mislabeled device punches: no classified 'out', but a later punch exists
  IF v_first_in IS NOT NULL AND v_last_out IS NULL THEN
    SELECT MAX(p.punch_at)
    INTO v_last_out
    FROM public.attendance_punches p
    WHERE p.employee_id = p_employee_id
      AND p.company_id = v_company_id
      AND (p.punch_at AT TIME ZONE v_company_tz)::date = p_date
      AND p.punch_at >= v_first_in + interval '60 minutes';
  END IF;

  -- Mirror fallback: only 'out'-labeled punches exist, take the earliest as check-in
  IF v_first_in IS NULL AND v_last_out IS NOT NULL THEN
    SELECT MIN(p.punch_at)
    INTO v_first_in
    FROM public.attendance_punches p
    WHERE p.employee_id = p_employee_id
      AND p.company_id = v_company_id
      AND (p.punch_at AT TIME ZONE v_company_tz)::date = p_date
      AND p.punch_at <= v_last_out - interval '60 minutes';
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
