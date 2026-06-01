-- ZKT LAN agent: track last pull + dedupe zkteco punches per employee/time

ALTER TABLE public.attendance_devices
  ADD COLUMN IF NOT EXISTS agent_last_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS agent_sync_notes text;

COMMENT ON COLUMN public.attendance_devices.agent_last_sync_at IS 'Last successful LAN pull by Hrm.ZktAgent (non-ADMS devices)';
COMMENT ON COLUMN public.attendance_devices.agent_sync_notes IS 'Last agent sync message or error summary';

-- Remove duplicate zkteco/import punches before unique index (keeps oldest row)
DELETE FROM public.attendance_punches a
USING public.attendance_punches b
WHERE a.source IN ('zkteco', 'import')
  AND b.source IN ('zkteco', 'import')
  AND a.employee_id = b.employee_id
  AND a.punch_at = b.punch_at
  AND a.id > b.id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_punches_zk_dedup
  ON public.attendance_punches (employee_id, punch_at)
  WHERE source IN ('zkteco', 'import');
