-- RUN IN SUPABASE SQL EDITOR (one time)

ALTER TABLE public.loans
  ADD COLUMN IF NOT EXISTS approver_id uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS requested_by uuid REFERENCES public.users(id);

CREATE INDEX IF NOT EXISTS idx_loans_approver_pending
  ON public.loans(approver_id)
  WHERE status = 'REQUESTED';

DROP POLICY IF EXISTS loan_select ON public.loans;
CREATE POLICY loan_select ON public.loans FOR SELECT TO authenticated
  USING (
    public.user_has_permission('loan.view')
    OR public.user_has_permission('loan.approve')
    OR approver_id = auth.uid()
    OR employee_id IN (SELECT employee_id FROM public.users WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS loan_insert ON public.loans;
CREATE POLICY loan_insert ON public.loans FOR INSERT TO authenticated
  WITH CHECK (
    company_id = public.current_user_company_id()
    AND (
      (
        public.user_has_permission('loan.create')
        AND employee_id IN (
          SELECT u.employee_id FROM public.users u
          WHERE u.id = auth.uid() AND u.employee_id IS NOT NULL
        )
      )
      OR (
        public.user_has_permission('loan.approve')
        AND EXISTS (
          SELECT 1 FROM public.employees e
          WHERE e.id = employee_id
            AND e.company_id = public.current_user_company_id()
        )
      )
    )
    AND approver_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.users au
      WHERE au.id = approver_id
        AND au.company_id = public.current_user_company_id()
        AND au.status = 'Active'
    )
  );

DROP POLICY IF EXISTS loan_update ON public.loans;
CREATE POLICY loan_update ON public.loans FOR UPDATE TO authenticated
  USING (
    (
      employee_id IN (SELECT employee_id FROM public.users WHERE id = auth.uid())
      AND status = 'REQUESTED'
    )
    OR approver_id = auth.uid()
    OR public.user_has_permission('loan.approve')
    OR public.user_has_permission('loan.update')
  )
  WITH CHECK (
    (
      employee_id IN (SELECT employee_id FROM public.users WHERE id = auth.uid())
      AND status IN ('REQUESTED', 'CANCELLED')
    )
    OR approver_id = auth.uid()
    OR public.user_has_permission('loan.approve')
    OR public.user_has_permission('loan.update')
  );

DROP POLICY IF EXISTS li_insert ON public.loan_installments;
CREATE POLICY li_insert ON public.loan_installments FOR INSERT TO authenticated
  WITH CHECK (
    public.user_has_permission('loan.approve')
    OR public.user_has_permission('loan.update')
    OR EXISTS (
      SELECT 1 FROM public.loans l
      WHERE l.id = loan_installments.loan_id
        AND l.approver_id = auth.uid()
    )
  );

NOTIFY pgrst, 'reload schema';

SELECT 'OK — loan give + approver routing' AS step;
