-- HR/admin can submit overtime for any employee in their company (goes to Pending for approval).

DROP POLICY IF EXISTS ot_insert ON public.overtime_requests;
CREATE POLICY ot_insert ON public.overtime_requests FOR INSERT TO authenticated
  WITH CHECK (
    company_id = public.current_user_company_id()
    AND (
      (
        public.user_has_permission('overtime.apply')
        AND employee_id IN (
          SELECT u.employee_id FROM public.users u
          WHERE u.id = auth.uid() AND u.employee_id IS NOT NULL
        )
      )
      OR (
        (
          public.user_has_permission('overtime.approve')
          OR public.user_has_permission('overtime.config')
        )
        AND EXISTS (
          SELECT 1 FROM public.employees e
          WHERE e.id = employee_id
            AND e.company_id = public.current_user_company_id()
        )
      )
    )
  );
