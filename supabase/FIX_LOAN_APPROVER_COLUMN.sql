-- =============================================================================
-- FIX: "Could not find the 'approver_id' column of 'loans' in the schema cache"
-- Copy ALL of this file → Supabase SQL Editor → Run once
-- https://supabase.com/dashboard/project/zxkkmwycimijvbpgqpfh/sql/new
-- =============================================================================

ALTER TABLE public.loans
  ADD COLUMN IF NOT EXISTS approver_id uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS requested_by uuid REFERENCES public.users(id);

-- Refresh API schema cache (PostgREST)
NOTIFY pgrst, 'reload schema';

SELECT
  column_name,
  data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'loans'
  AND column_name IN ('approver_id', 'requested_by');
