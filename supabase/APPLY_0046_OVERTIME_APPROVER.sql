-- RUN IN SUPABASE SQL EDITOR (one time) — Overtime Approval routing

ALTER TABLE public.overtime_requests
  ADD COLUMN IF NOT EXISTS approver_id uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS requested_by uuid REFERENCES public.users(id);

CREATE INDEX IF NOT EXISTS idx_ot_approver_pending
  ON public.overtime_requests(approver_id)
  WHERE status = 'PENDING';

DROP POLICY IF EXISTS ot_select ON public.overtime_requests;
CREATE POLICY ot_select ON public.overtime_requests FOR SELECT TO authenticated
  USING (
    public.user_has_permission('overtime.view')
    OR public.user_has_permission('overtime.approve')
    OR approver_id = auth.uid()
    OR employee_id IN (SELECT employee_id FROM public.users WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS ot_update ON public.overtime_requests;
CREATE POLICY ot_update ON public.overtime_requests FOR UPDATE TO authenticated
  USING (
    (employee_id IN (SELECT employee_id FROM public.users WHERE id = auth.uid()) AND status = 'PENDING')
    OR approver_id = auth.uid()
    OR public.user_has_permission('overtime.approve')
    OR public.user_has_permission('overtime.config')
  )
  WITH CHECK (
    employee_id IN (SELECT employee_id FROM public.users WHERE id = auth.uid())
    OR approver_id = auth.uid()
    OR public.user_has_permission('overtime.approve')
    OR public.user_has_permission('overtime.config')
  );

NOTIFY pgrst, 'reload schema';

SELECT 'OK — overtime approver routing' AS step;
