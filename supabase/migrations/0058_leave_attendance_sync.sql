-- Approved leave now reflects in attendance_daily as status 'Leave'.
-- Previously nothing wrote 'Leave' into attendance, so approved leave days kept showing 'Absent'.

CREATE OR REPLACE FUNCTION public.sync_leave_attendance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
BEGIN
  SELECT e.company_id INTO v_company_id
  FROM public.employees e
  WHERE e.id = NEW.employee_id;

  IF v_company_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Became Approved -> mark days as Leave (never overwrite days with actual punches/work)
  IF NEW.status = 'Approved'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'Approved') THEN
    INSERT INTO public.attendance_daily (company_id, employee_id, attendance_date, status, notes)
    SELECT v_company_id, NEW.employee_id, d::date, 'Leave', 'Approved leave'
    FROM generate_series(NEW.start_date::timestamp, NEW.end_date::timestamp, interval '1 day') d
    ON CONFLICT (employee_id, attendance_date) DO UPDATE
      SET status = 'Leave',
          notes = COALESCE(attendance_daily.notes, 'Approved leave'),
          updated_at = now()
      WHERE attendance_daily.first_in IS NULL
        AND attendance_daily.status = 'Absent';

  -- Was Approved, now Cancelled/Rejected -> revert Leave days back to Absent
  ELSIF TG_OP = 'UPDATE'
        AND OLD.status = 'Approved'
        AND NEW.status IS DISTINCT FROM 'Approved' THEN
    UPDATE public.attendance_daily
    SET status = 'Absent', updated_at = now()
    WHERE employee_id = NEW.employee_id
      AND attendance_date BETWEEN NEW.start_date AND NEW.end_date
      AND status = 'Leave'
      AND first_in IS NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_leave_attendance ON public.leave_applications;
CREATE TRIGGER trg_sync_leave_attendance
AFTER INSERT OR UPDATE OF status ON public.leave_applications
FOR EACH ROW
EXECUTE FUNCTION public.sync_leave_attendance();

-- Backfill: apply all existing approved leaves to attendance
INSERT INTO public.attendance_daily (company_id, employee_id, attendance_date, status, notes)
SELECT e.company_id, la.employee_id, d::date, 'Leave', 'Approved leave'
FROM public.leave_applications la
JOIN public.employees e ON e.id = la.employee_id
CROSS JOIN LATERAL generate_series(la.start_date::timestamp, la.end_date::timestamp, interval '1 day') d
WHERE la.status = 'Approved'
ON CONFLICT (employee_id, attendance_date) DO UPDATE
  SET status = 'Leave',
      notes = COALESCE(attendance_daily.notes, 'Approved leave'),
      updated_at = now()
  WHERE attendance_daily.first_in IS NULL
    AND attendance_daily.status = 'Absent';
