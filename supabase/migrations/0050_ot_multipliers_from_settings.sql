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
