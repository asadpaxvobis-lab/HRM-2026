-- RUN IN SUPABASE SQL EDITOR (one time)
-- Lets employees see their own basic salary for overtime pay calculation.

DROP POLICY IF EXISTS salary_select_self ON public.employee_salary_history;
CREATE POLICY salary_select_self ON public.employee_salary_history
  FOR SELECT TO authenticated
  USING (
    employee_id IN (
      SELECT u.employee_id
      FROM public.users u
      WHERE u.id = auth.uid()
        AND u.employee_id IS NOT NULL
    )
  );

SELECT 'OK — employee_salary_history self-read policy' AS step;
