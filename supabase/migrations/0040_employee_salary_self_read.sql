-- Allow employees to read their own salary history (needed for overtime pay estimate).
-- HR/payroll roles keep existing salary_select policy.

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
