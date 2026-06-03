-- Allow assigned approver to create installment rows when activating a loan.

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
