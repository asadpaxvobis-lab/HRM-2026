-- Office ZKT agent heartbeat + per-device LAN status message (visible from cloud HRM)

ALTER TABLE public.attendance_devices
  ADD COLUMN IF NOT EXISTS agent_lan_message text;

COMMENT ON COLUMN public.attendance_devices.agent_lan_message IS
  'Latest LAN connect status from Hrm.ZktAgent (Connected / Not connected + reason)';

CREATE TABLE IF NOT EXISTS public.zkt_agent_heartbeat (
  company_id     uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  host_name      text,
  is_syncing     boolean NOT NULL DEFAULT false,
  cycle_summary  text,
  devices_online int NOT NULL DEFAULT 0,
  devices_total  int NOT NULL DEFAULT 0,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.zkt_agent_heartbeat IS
  'Updated every agent sync cycle so Admin → Devices works from Vercel (not only localhost)';

ALTER TABLE public.zkt_agent_heartbeat ENABLE ROW LEVEL SECURITY;

CREATE POLICY zkt_agent_heartbeat_select ON public.zkt_agent_heartbeat
  FOR SELECT TO authenticated
  USING (company_id = public.current_user_company_id());
