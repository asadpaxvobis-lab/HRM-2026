-- Approved corrections replace manual punches for that day (avoids duplicates on re-aggregate).

CREATE OR REPLACE FUNCTION public.approve_attendance_correction(
  p_correction_id uuid,
  p_status text,
  p_decision_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_corr public.attendance_corrections%ROWTYPE;
  v_company_id uuid;
  v_tz text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.user_has_permission('attendance.approve') THEN
    RAISE EXCEPTION 'attendance.approve permission required';
  END IF;

  IF p_status NOT IN ('Approved', 'Rejected') THEN
    RAISE EXCEPTION 'Invalid status';
  END IF;

  SELECT * INTO v_corr
  FROM public.attendance_corrections
  WHERE id = p_correction_id;

  IF v_corr.id IS NULL THEN
    RAISE EXCEPTION 'Correction not found';
  END IF;

  SELECT e.company_id, COALESCE(c.timezone, 'Asia/Karachi')
  INTO v_company_id, v_tz
  FROM public.employees e
  JOIN public.companies c ON c.id = e.company_id
  WHERE e.id = v_corr.employee_id;

  IF v_company_id IS DISTINCT FROM public.current_user_company_id() THEN
    RAISE EXCEPTION 'company mismatch';
  END IF;

  IF v_corr.status <> 'Pending' THEN
    RAISE EXCEPTION 'Correction is not pending';
  END IF;

  UPDATE public.attendance_corrections
  SET
    status = p_status,
    decision_note = NULLIF(trim(p_decision_note), ''),
    decided_at = now(),
    approver_id = auth.uid()
  WHERE id = p_correction_id;

  IF p_status = 'Approved' THEN
    DELETE FROM public.attendance_punches p
    WHERE p.employee_id = v_corr.employee_id
      AND p.company_id = v_company_id
      AND p.source = 'manual'
      AND (p.punch_at AT TIME ZONE v_tz)::date = v_corr.attendance_date;

    IF v_corr.proposed_in IS NOT NULL THEN
      INSERT INTO public.attendance_punches (
        company_id, employee_id, punch_at, punch_type, source, notes, created_by
      ) VALUES (
        v_company_id,
        v_corr.employee_id,
        v_corr.proposed_in,
        'in',
        'manual',
        left('Correction approved: ' || v_corr.reason, 500),
        auth.uid()
      );
    END IF;

    IF v_corr.proposed_out IS NOT NULL THEN
      INSERT INTO public.attendance_punches (
        company_id, employee_id, punch_at, punch_type, source, notes, created_by
      ) VALUES (
        v_company_id,
        v_corr.employee_id,
        v_corr.proposed_out,
        'out',
        'manual',
        left('Correction approved: ' || v_corr.reason, 500),
        auth.uid()
      );
    END IF;

    PERFORM public.recompute_attendance_for_employee(v_corr.employee_id, v_corr.attendance_date);
  END IF;
END;
$$;
