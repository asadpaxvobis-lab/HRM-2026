-- OT pay estimate for employees (self) and HR/admin — reads salary via SECURITY DEFINER.

CREATE OR REPLACE FUNCTION public.get_ot_pay_context(
  p_employee_id uuid,
  p_ot_date date,
  p_planned_hours numeric DEFAULT 0,
  p_rate_multiplier numeric DEFAULT 1.5,
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
  v_hourly := ROUND(
    v_basic / (
      EXTRACT(DAY FROM (date_trunc('month', p_ot_date::timestamp) + interval '1 month' - interval '1 day'))::numeric
      * 8
    ),
    2
  );
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

GRANT EXECUTE ON FUNCTION public.get_ot_pay_context(uuid, date, numeric, numeric, uuid) TO authenticated;
