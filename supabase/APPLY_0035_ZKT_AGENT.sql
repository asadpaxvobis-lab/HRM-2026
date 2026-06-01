-- =============================================================================
-- Run in Supabase Dashboard → SQL Editor (project: zxkkmwycimijvbpgqpfh)
-- https://supabase.com/dashboard/project/zxkkmwycimijvbpgqpfh/sql/new
-- Migration: 0035_zkt_agent_sync — ZKT LAN agent columns + punch dedupe index
-- =============================================================================

-- 1) Agent sync status on devices (for Admin → Devices)
ALTER TABLE public.attendance_devices
  ADD COLUMN IF NOT EXISTS agent_last_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS agent_sync_notes text;

COMMENT ON COLUMN public.attendance_devices.agent_last_sync_at IS
  'Last successful LAN pull by Hrm.ZktAgent (non-ADMS devices)';
COMMENT ON COLUMN public.attendance_devices.agent_sync_notes IS
  'Last agent sync message or error summary';

-- 2) Remove duplicate zkteco/import punches before unique index (keeps oldest row)
DELETE FROM public.attendance_punches a
USING public.attendance_punches b
WHERE a.source IN ('zkteco', 'import')
  AND b.source IN ('zkteco', 'import')
  AND a.employee_id = b.employee_id
  AND a.punch_at = b.punch_at
  AND a.id > b.id;

-- 3) Prevent duplicate device imports for same employee + time
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_punches_zk_dedup
  ON public.attendance_punches (employee_id, punch_at)
  WHERE source IN ('zkteco', 'import');

-- 4) Verify (should return 2 rows: agent_last_sync_at, agent_sync_notes)
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'attendance_devices'
  AND column_name IN ('agent_last_sync_at', 'agent_sync_notes')
ORDER BY column_name;
