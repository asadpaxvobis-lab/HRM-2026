-- Allow deleting payroll periods in any status (payslips/runs cascade).
DROP POLICY IF EXISTS pp_delete ON public.payroll_periods;
CREATE POLICY pp_delete ON public.payroll_periods FOR DELETE TO authenticated
  USING (
    company_id = public.current_user_company_id()
    AND public.user_has_permission('payroll.run')
  );
