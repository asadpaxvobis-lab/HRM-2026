import { useEffect, useState } from 'react'
import {
  Plus,
  Pencil,
  RefreshCw,
  Loader2,
  HardDrive,
  Trash2,
  Save,
  Activity,
  Power,
  PowerOff,
  Download,
  Users,
  FileText,
  Play,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  getZktAgentUrl,
  fetchZktAgentHealth,
  fetchZktAgentCycleStatus,
  fetchZktDeviceLanStatuses,
  isOfficePcBrowser,
  pingZktAgent,
  type ZktDeviceLanStatus,
  resetZktAgentSync,
  runZktAgentSyncWithProgress,
  runZktAgentOnOfficePc,
  setZktAgentUrl,
  waitForZktAgentOnline,
  type ZktSyncProgress,
} from '@/lib/zktAgent'
import { loadAllDevicePinRows } from '@/lib/employeeDevicePin'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { writeAuditLog } from '@/lib/audit'
import { PageHeader } from '@/components/master/PageHeader'
import { HasPermission } from '@/components/HasPermission'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from 'sonner'

type Device = {
  id: string
  branch_id: string | null
  name: string
  serial_no: string | null
  device_type: string
  ip_address: string | null
  push_token: string | null
  last_seen_at: string | null
  agent_last_sync_at: string | null
  agent_sync_notes: string | null
  agent_connect_ok: boolean | null
  agent_connect_checked_at: string | null
  agent_lan_message: string | null
  is_active: boolean
  notes: string | null
  branches?: { name: string } | null
}

type Branch = { id: string; name: string }

type AgentHeartbeat = {
  last_seen_at: string
  host_name: string | null
  is_syncing: boolean
  cycle_summary: string | null
  devices_online: number
  devices_total: number
}

type FetchRun = {
  id: string
  device_id: string
  started_at: string
  finished_at: string
  success: boolean
  logs_read: number
  excluded_before_cursor: number
  inserted_count: number
  duplicate_count: number
  skipped_count: number
  summary: string | null
  error_message: string | null
}

type FetchLogEntry = {
  id: string
  run_id: string
  device_pin: number | null
  punch_at: string | null
  outcome: string
  reason: string
}

function outcomeBadgeVariant(outcome: string): 'warm' | 'secondary' | 'outline' | 'destructive' {
  if (outcome === 'inserted') return 'warm'
  if (outcome === 'duplicate') return 'secondary'
  if (outcome === 'unmapped_pin' || outcome === 'capped' || outcome === 'before_cursor') return 'outline'
  if (outcome === 'error') return 'destructive'
  return 'outline'
}

const AGENT_STALE_MS = 35_000

function heartbeatIsFresh(hb: AgentHeartbeat | null): boolean {
  if (!hb?.last_seen_at) return false
  return Date.now() - new Date(hb.last_seen_at).getTime() < AGENT_STALE_MS
}

type PinEmployee = {
  id: string
  employee_code: string
  full_name: string
  device_pin: number | null
  branches?: { name: string } | null
}

type DevicePinRow = {
  employee_id: string
  device_id: string
  device_pin: number
  attendance_devices?: { name: string } | null
}

const DEVICE_TYPES = ['ZKTeco', 'Face Kiosk', 'Mobile', 'Manual'] as const

/** PINs on the device that are not linked to any HRM employee (from last agent sync notes). */
function parseUnmappedPinsFromNotes(notes: string | null): number[] {
  if (!notes) return []
  const match = notes.match(/unmapped PINs?:\s*([\d,\s]+)/i)
  if (!match) return []
  return [...new Set(match[1].split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n) && n > 0))]
}

function collectUnmappedPins(devices: Device[]): number[] {
  const all = new Set<number>()
  for (const d of devices) {
    for (const pin of parseUnmappedPinsFromNotes(d.agent_sync_notes)) {
      all.add(pin)
    }
  }
  return [...all].sort((a, b) => a - b)
}

const emptyForm = {
  name: '',
  serial_no: '',
  device_type: 'ZKTeco',
  branch_id: '',
  ip_address: '',
  push_token: '',
  is_active: true,
  notes: '',
}

function pushEndpointUrl(token: string, serial?: string | null) {
  const base = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, '') ?? ''
  const sn = serial?.trim() ? `&SN=${encodeURIComponent(serial.trim())}` : ''
  return `${base}/functions/v1/zkteco-push/iclock/cdata?token=${encodeURIComponent(token)}${sn}`
}

function genToken() {
  const arr = new Uint8Array(24)
  crypto.getRandomValues(arr)
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('')
}

function lastSeenBadge(iso: string | null): { label: string; variant: 'warm' | 'outline' | 'secondary' } {
  if (!iso) return { label: 'Never', variant: 'secondary' }
  const ageMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ageMs / 60000)
  if (mins < 5) return { label: 'Online', variant: 'warm' }
  if (mins < 60) return { label: `${mins}m ago`, variant: 'outline' }
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return { label: `${hrs}h ago`, variant: 'outline' }
  const days = Math.floor(hrs / 24)
  return { label: `${days}d ago`, variant: 'secondary' }
}

export function DevicesPage() {
  const { appUser, hasPermission } = useAuth()
  const canManage = hasPermission('attendance.device')
  const [rows, setRows] = useState<Device[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Device | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [busy, setBusy] = useState(false)
  const [syncBusy, setSyncBusy] = useState(false)
  const [agentStartBusy, setAgentStartBusy] = useState(false)
  const [agentUrl, setAgentUrl] = useState(() => getZktAgentUrl())
  const [agentOnline, setAgentOnline] = useState<boolean | null>(null)
  const [zkSdkReady, setZkSdkReady] = useState<boolean | null>(null)
  const [zkSdkHint, setZkSdkHint] = useState<string | null>(null)
  const [lanStatus, setLanStatus] = useState<Record<string, ZktDeviceLanStatus>>({})
  const [agentHeartbeat, setAgentHeartbeat] = useState<AgentHeartbeat | null>(null)
  const [autoSyncSummary, setAutoSyncSummary] = useState<string | null>(null)
  const [fetchLogDeviceId, setFetchLogDeviceId] = useState('')
  const [fetchRuns, setFetchRuns] = useState<FetchRun[]>([])
  const [fetchEntries, setFetchEntries] = useState<FetchLogEntry[]>([])
  const [selectedFetchRunId, setSelectedFetchRunId] = useState<string | null>(null)
  const [fetchLogLoading, setFetchLogLoading] = useState(false)
  const [zkPunchCount, setZkPunchCount] = useState<number | null>(null)
  const onOfficePc = isOfficePcBrowser()
  const [syncProgress, setSyncProgress] = useState<ZktSyncProgress | null>(null)
  const [pinEmployees, setPinEmployees] = useState<PinEmployee[]>([])
  const [devicePinRows, setDevicePinRows] = useState<DevicePinRow[]>([])
  const [lastDeviceByEmployee, setLastDeviceByEmployee] = useState<Map<string, string>>(new Map())

  async function loadDevicesFromDb() {
    const selects = [
      'id, branch_id, name, serial_no, device_type, ip_address, push_token, last_seen_at, agent_last_sync_at, agent_sync_notes, agent_connect_ok, agent_connect_checked_at, agent_lan_message, is_active, notes, branches(name)',
      'id, branch_id, name, serial_no, device_type, ip_address, push_token, last_seen_at, agent_last_sync_at, agent_sync_notes, agent_connect_ok, agent_connect_checked_at, is_active, notes, branches(name)',
      'id, branch_id, name, serial_no, device_type, ip_address, push_token, last_seen_at, agent_last_sync_at, agent_sync_notes, is_active, notes, branches(name)',
      'id, branch_id, name, serial_no, device_type, ip_address, push_token, last_seen_at, is_active, notes, branches(name)',
    ]
    let last = await supabase.from('attendance_devices').select(selects[0]).order('name')
    for (let i = 1; i < selects.length && last.error?.message?.includes('does not exist'); i++) {
      last = await supabase.from('attendance_devices').select(selects[i]).order('name')
    }
    return last
  }

  async function load() {
    setLoading(true)
    const d = await loadDevicesFromDb()
    const [b, p, emps, punches, edpRows] = await Promise.all([
      supabase.from('branches').select('id, name').eq('is_active', true).order('name'),
      supabase.from('attendance_punches').select('id', { count: 'exact', head: true }).eq('source', 'zkteco'),
      supabase
        .from('employees')
        .select('id, employee_code, full_name, device_pin, branches(name)')
        .eq('is_active', true)
        .order('full_name'),
      supabase
        .from('attendance_punches')
        .select('employee_id, punch_at, attendance_devices(name)')
        .eq('source', 'zkteco')
        .not('device_id', 'is', null)
        .order('punch_at', { ascending: false })
        .limit(800),
      loadAllDevicePinRows(appUser!.company_id),
    ])

    if (d.error) {
      toast.error('Failed to load devices', { description: d.error.message })
    } else {
      const mapped = ((d.data ?? []) as unknown as Record<string, unknown>[]).map((r) => {
        const br = r.branches
        return { ...r, branches: Array.isArray(br) ? br[0] : br } as Device
      })
      setRows(mapped)
    }
    setBranches((b.data ?? []) as Branch[])
    setZkPunchCount(p.count ?? 0)

    const mappedEmps = (emps.data ?? []).map((r: Record<string, unknown>) => {
      const br = r.branches
      return {
        ...r,
        branches: Array.isArray(br) ? br[0] : br,
      } as PinEmployee
    })
    setPinEmployees(mappedEmps)
    setDevicePinRows(edpRows as DevicePinRow[])

    const byEmp = new Map<string, string>()
    for (const row of punches.data ?? []) {
      const rec = row as {
        employee_id: string
        attendance_devices?: { name: string } | { name: string }[] | null
      }
      if (byEmp.has(rec.employee_id)) continue
      const dev = rec.attendance_devices
      const name = Array.isArray(dev) ? dev[0]?.name : dev?.name
      if (name) byEmp.set(rec.employee_id, name)
    }
    setLastDeviceByEmployee(byEmp)

    setLoading(false)
    void refreshAgentStatus()
  }

  async function loadAgentHeartbeat() {
    if (!appUser?.company_id) return
    const { data, error } = await supabase
      .from('zkt_agent_heartbeat')
      .select('last_seen_at, host_name, is_syncing, cycle_summary, devices_online, devices_total')
      .eq('company_id', appUser.company_id)
      .maybeSingle()
    if (!error && data) {
      setAgentHeartbeat(data as AgentHeartbeat)
    }
  }

  async function refreshDevicesQuiet() {
    const d = await loadDevicesFromDb()
    if (!d.error) {
      const mapped = ((d.data ?? []) as unknown as Record<string, unknown>[]).map((r) => {
        const br = r.branches
        return { ...r, branches: Array.isArray(br) ? br[0] : br } as Device
      })
      setRows(mapped)
    }
    await loadAgentHeartbeat()
  }

  async function refreshAgentStatus() {
    let hb: AgentHeartbeat | null = agentHeartbeat
    if (appUser?.company_id) {
      const { data, error } = await supabase
        .from('zkt_agent_heartbeat')
        .select('last_seen_at, host_name, is_syncing, cycle_summary, devices_online, devices_total')
        .eq('company_id', appUser.company_id)
        .maybeSingle()
      if (!error && data) {
        hb = data as AgentHeartbeat
        setAgentHeartbeat(hb)
      }
    }

    const hbFresh = heartbeatIsFresh(hb)
    if (hb?.cycle_summary) setAutoSyncSummary(hb.cycle_summary)

    if (onOfficePc) {
      const health = await fetchZktAgentHealth(agentUrl)
      setAgentOnline(health?.ok === true || hbFresh)
      setZkSdkReady(health?.zkemkeeper ?? null)
      setZkSdkHint(health?.hint ?? null)
      const cycle = await fetchZktAgentCycleStatus(agentUrl)
      if (cycle?.summary) setAutoSyncSummary(cycle.summary)
      if (cycle?.devices?.length) {
        const map: Record<string, ZktDeviceLanStatus> = {}
        for (const p of cycle.devices) map[p.id] = p
        setLanStatus(map)
      }
    } else {
      setAgentOnline(hbFresh)
      setZkSdkReady(null)
      setZkSdkHint(
        hbFresh
          ? null
          : 'Office agent not detected. Run run-agent.ps1 on the office PC — status updates here every 10 seconds.',
      )
    }
  }

  const unmappedPins = collectUnmappedPins(rows)
  const mappedWithPin = pinEmployees.filter((e) => e.device_pin != null && e.device_pin > 0)
  const missingPin = pinEmployees.filter((e) => e.device_pin == null || e.device_pin <= 0)
  const pinByNumber = new Map(mappedWithPin.map((e) => [e.device_pin!, e]))

  async function runAgent() {
    if (!onOfficePc) {
      toast.error('Run agent works on the office PC only', {
        description:
          'Open HRM at http://localhost:5173 on the same PC as ZKTime, then use Run agent.',
      })
      return
    }
    if (agentOnline) {
      toast.info('Agent is already running', {
        description: 'Use Test agent & LAN or Pull from device.',
      })
      return
    }
    setAgentStartBusy(true)
    try {
      const launch = await runZktAgentOnOfficePc()
      if (!launch.ok) {
        toast.error('Could not start agent', { description: launch.error })
        return
      }
      toast.success(launch.message ?? 'Starting agent…', {
        description: 'A PowerShell window should open. Leave it open.',
      })
      const online = await waitForZktAgentOnline(agentUrl, { timeoutMs: 90_000, pollMs: 2000 })
      if (online) {
        toast.success('Agent is online')
        await checkAgent()
        void refreshAgentStatus()
      } else {
        toast.error('Agent did not respond yet', {
          description:
            'If the PowerShell window closed instantly, open apps\\agent and run: .\\setup-agent.ps1 then .\\run-agent-window.ps1',
        })
      }
    } finally {
      setAgentStartBusy(false)
    }
  }

  async function checkAgent() {
    const health = await fetchZktAgentHealth(agentUrl)
    setAgentOnline(health?.ok === true)
    setZkSdkReady(health?.zkemkeeper ?? null)
    setZkSdkHint(health?.hint ?? null)
    if (health?.ok) {
      const probes = await fetchZktDeviceLanStatuses(agentUrl)
      const map: Record<string, ZktDeviceLanStatus> = {}
      for (const p of probes) map[p.id] = p
      setLanStatus(map)
    } else {
      setLanStatus({})
    }
  }

  const agentUrlLooksWrong = /:17888\b/.test(agentUrl)

  async function resetSyncCursor() {
    if (!confirm('Clear sync cursor and re-import the last 90 days from devices on the next pull?')) return
    setSyncBusy(true)
    try {
      await resetZktAgentSync(agentUrl)
      toast.success('Sync cursor reset', { description: 'Click Pull from device to re-import.' })
    } catch (e) {
      toast.error('Reset failed', { description: e instanceof Error ? e.message : 'Could not reach agent' })
    } finally {
      setSyncBusy(false)
    }
  }

  async function pullFromDevices() {
    setSyncBusy(true)
    setSyncProgress(null)
    setZktAgentUrl(agentUrl)
    try {
      const result = await runZktAgentSyncWithProgress(agentUrl, setSyncProgress)
      setSyncProgress(result)
      toast.success('Device pull finished', {
        description: result.results?.join(' · ') ?? result.message,
      })
      await load()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not reach agent'
      toast.error('Pull failed', {
        description: `${msg}. On the office PC run: powershell -ExecutionPolicy Bypass -File run-agent.ps1 (keep window open). HRM must be on the same PC, or set Agent URL to this PC's LAN IP. Disconnect ZKTime first.`,
      })
    } finally {
      setSyncBusy(false)
    }
  }

  function phaseLabel(phase: string) {
    const labels: Record<string, string> = {
      idle: 'Idle',
      starting: 'Starting',
      connect: 'Connecting',
      read: 'Reading device',
      map: 'Mapping PINs',
      upload: 'Uploading',
      recompute: 'Updating attendance',
      done: 'Done',
      error: 'Error',
      device: 'Device',
    }
    return labels[phase] ?? phase
  }

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    const timer = setInterval(() => {
      void refreshDevicesQuiet()
      void refreshAgentStatus()
      if (fetchLogDeviceId) void loadFetchLogs(fetchLogDeviceId)
    }, 10_000)
    return () => clearInterval(timer)
  }, [agentUrl, appUser?.company_id, fetchLogDeviceId])

  async function loadFetchLogs(deviceId: string) {
    if (!deviceId) {
      setFetchRuns([])
      setFetchEntries([])
      setSelectedFetchRunId(null)
      return
    }
    setFetchLogLoading(true)
    const runsRes = await supabase
      .from('zkt_device_fetch_runs')
      .select(
        'id, device_id, started_at, finished_at, success, logs_read, excluded_before_cursor, inserted_count, duplicate_count, skipped_count, summary, error_message'
      )
      .eq('device_id', deviceId)
      .order('started_at', { ascending: false })
      .limit(15)

    if (runsRes.error) {
      setFetchRuns([])
      setFetchEntries([])
      setFetchLogLoading(false)
      return
    }

    const runs = (runsRes.data ?? []) as FetchRun[]
    setFetchRuns(runs)
    const runId = selectedFetchRunId && runs.some((r) => r.id === selectedFetchRunId)
      ? selectedFetchRunId
      : runs[0]?.id ?? null
    setSelectedFetchRunId(runId)

    if (!runId) {
      setFetchEntries([])
      setFetchLogLoading(false)
      return
    }

    const entriesRes = await supabase
      .from('zkt_fetch_log_entries')
      .select('id, run_id, device_pin, punch_at, outcome, reason')
      .eq('run_id', runId)
      .order('punch_at', { ascending: true })
      .limit(500)

    setFetchEntries(entriesRes.error ? [] : ((entriesRes.data ?? []) as FetchLogEntry[]))
    setFetchLogLoading(false)
  }

  const openCreate = () => {
    setEditing(null)
    setForm({ ...emptyForm, push_token: genToken() })
    setOpen(true)
  }

  const openEdit = (d: Device) => {
    setEditing(d)
    setForm({
      name: d.name,
      serial_no: d.serial_no ?? '',
      device_type: d.device_type,
      branch_id: d.branch_id ?? '',
      ip_address: d.ip_address ?? '',
      push_token: d.push_token ?? '',
      is_active: d.is_active,
      notes: d.notes ?? '',
    })
    setOpen(true)
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!appUser) return
    setBusy(true)
    const payload = {
      company_id: appUser.company_id,
      name: form.name.trim(),
      serial_no: form.serial_no.trim() || null,
      device_type: form.device_type,
      branch_id: form.branch_id || null,
      ip_address: form.ip_address.trim() || null,
      push_token: form.push_token.trim() || null,
      is_active: form.is_active,
      notes: form.notes.trim() || null,
    }
    if (editing) {
      const { error } = await supabase.from('attendance_devices').update(payload).eq('id', editing.id)
      setBusy(false)
      if (error) {
        toast.error('Update failed', { description: error.message })
        return
      }
      await writeAuditLog({ action: 'UPDATE', entityType: 'attendance_device', entityId: editing.id, after: payload })
      toast.success('Device updated')
    } else {
      const { data, error } = await supabase.from('attendance_devices').insert(payload).select('id').single()
      setBusy(false)
      if (error) {
        toast.error('Create failed', { description: error.message })
        return
      }
      await writeAuditLog({ action: 'CREATE', entityType: 'attendance_device', entityId: data?.id, after: payload })
      toast.success('Device registered')
    }
    setOpen(false)
    void load()
  }

  const toggleActive = async (d: Device) => {
    const next = !d.is_active
    const { error } = await supabase.from('attendance_devices').update({ is_active: next }).eq('id', d.id)
    if (error) {
      toast.error('Failed', { description: error.message })
      return
    }
    await writeAuditLog({ action: next ? 'ENABLE' : 'DISABLE', entityType: 'attendance_device', entityId: d.id })
    toast.success(next ? 'Device enabled' : 'Device disabled')
    void load()
  }

  const onDelete = async (d: Device) => {
    if (!confirm(`Delete device "${d.name}"? This keeps existing punches.`)) return
    const { error } = await supabase.from('attendance_devices').delete().eq('id', d.id)
    if (error) {
      toast.error('Delete failed', { description: error.message })
      return
    }
    await writeAuditLog({ action: 'DELETE', entityType: 'attendance_device', entityId: d.id })
    toast.success('Device deleted')
    void load()
  }

  const copyToken = async (token: string | null) => {
    if (!token) return
    try {
      await navigator.clipboard.writeText(token)
      toast.success('Push token copied')
    } catch {
      toast.error('Could not copy')
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance devices"
        description="Register ZKTeco machines, face kiosks, mobile apps, and manual sources. Configure the push URL on the device to send punches automatically."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <HasPermission perm="attendance.device">
              <Button size="sm" onClick={openCreate}>
                <Plus className="h-4 w-4" /> Add device
              </Button>
            </HasPermission>
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">ZKTeco LAN pull (K40 without ADMS)</CardTitle>
          <CardDescription>
            Run the Windows agent on the office PC. It auto-syncs every <strong>10 seconds</strong> and reports which
            devices are connected. Data is stored in <span className="font-mono text-xs">attendance_punches</span>{' '}
            (<span className="font-mono text-xs">source = zkteco</span>).
            {!onOfficePc ? (
              <span className="block mt-2 text-amber-700 dark:text-amber-400">
                You are on the cloud site — <span className="font-mono">127.0.0.1</span> will not work here. Device
                status below is updated by the office PC agent via Supabase.
              </span>
            ) : null}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 border-b pb-6">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1 flex-1 min-w-[220px]">
              <Label className="text-xs">Agent URL (office PC)</Label>
              <Input
                value={agentUrl}
                onChange={(e) => setAgentUrl(e.target.value)}
                className="font-mono text-xs"
                placeholder="http://127.0.0.1:17880"
              />
            </div>
            <Button variant="outline" size="sm" onClick={() => void checkAgent()}>
              Test agent &amp; LAN
            </Button>
            <HasPermission perm="attendance.device">
              <Button
                variant="outline"
                size="sm"
                disabled={agentStartBusy || agentOnline === true}
                onClick={() => void runAgent()}
                title="Starts run-agent.ps1 on this PC (office PC with ZKTime)"
              >
                {agentStartBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                Run agent
              </Button>
              <Button variant="outline" size="sm" disabled={syncBusy} onClick={() => void resetSyncCursor()}>
                Reset sync cursor
              </Button>
              <Button size="sm" disabled={syncBusy} onClick={() => void pullFromDevices()}>
                {syncBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Pull from device
              </Button>
            </HasPermission>
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <span>
              Office agent:{' '}
              {agentOnline === null && !agentHeartbeat ? (
                '—'
              ) : agentOnline || heartbeatIsFresh(agentHeartbeat) ? (
                <Badge variant="warm">
                  Working
                  {agentHeartbeat?.host_name ? ` (${agentHeartbeat.host_name})` : ''}
                </Badge>
              ) : (
                <Badge variant="secondary">Not working</Badge>
              )}
            </span>
            {heartbeatIsFresh(agentHeartbeat) ? (
              <span className="text-xs text-muted-foreground">
                Last sync{' '}
                {new Date(agentHeartbeat!.last_seen_at).toLocaleTimeString('en-PK', { timeStyle: 'short' })}
                {agentHeartbeat!.is_syncing
                  ? ' · syncing now…'
                  : ` · ${agentHeartbeat!.devices_online}/${agentHeartbeat!.devices_total} device(s) connected`}
              </span>
            ) : null}
            {autoSyncSummary ? (
              <p className="w-full text-xs text-muted-foreground">{autoSyncSummary}</p>
            ) : null}
            {agentUrlLooksWrong ? (
              <p className="w-full text-xs text-amber-700 dark:text-amber-400">
                Agent URL port looks wrong. Use <code className="text-foreground">http://127.0.0.1:17880</code>{' '}
                (not 17888). The agent listens on port 17880 by default.
              </p>
            ) : null}
            {agentOnline === false ? (
              <p className="w-full text-xs text-muted-foreground">
                On the office PC: click <strong>Run agent</strong> above (runs{' '}
                <code className="text-foreground">run-agent.ps1</code>), or open PowerShell in{' '}
                <code className="text-foreground">apps\agent</code> and run{' '}
                <code className="text-foreground">.\setup-agent.ps1</code> once, then{' '}
                <code className="text-foreground">.\run-agent.ps1</code>. For the button, also run{' '}
                <code className="text-foreground">Start-Launcher.cmd</code> (double-click) or{' '}
                <code className="text-foreground">& .\agent-launcher.ps1</code> in this folder — not{' '}
                <code className="text-foreground">powershell -File</code> inside PowerShell (Access denied). Agent URL:{' '}
                <code className="text-foreground">http://127.0.0.1:17880</code>.
              </p>
            ) : null}
            {agentOnline && zkSdkReady === false ? (
              <p className="w-full text-xs text-amber-700 dark:text-amber-400">
                Agent is running but ZKTime SDK is missing on this PC. Install{' '}
                <strong>ZKTime</strong> or <strong>ZKBio Time</strong> (same app you use for attendance), restart the
                agent, disconnect the device in ZKTime, then pull again.
                {zkSdkHint ? <span className="block mt-1">{zkSdkHint}</span> : null}
              </p>
            ) : null}
            <span>
              ZKTeco punches in DB: <strong>{zkPunchCount ?? '—'}</strong>
            </span>
            <Link to="/attendance" className="text-primary underline-offset-4 hover:underline text-sm">
              View attendance →
            </Link>
          </div>

          {(syncBusy || syncProgress) && (
            <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-medium">
                  {syncBusy && !syncProgress
                    ? 'Starting sync…'
                    : syncProgress?.message ?? 'Sync in progress'}
                </span>
                {syncProgress && (
                  <span className="text-muted-foreground tabular-nums">{syncProgress.percent}%</span>
                )}
              </div>
              <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300 ease-out"
                  style={{ width: `${syncProgress?.percent ?? (syncBusy ? 3 : 0)}%` }}
                />
              </div>
              {syncProgress && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>Step: {phaseLabel(syncProgress.phase)}</span>
                  {syncProgress.deviceName && <span>Device: {syncProgress.deviceName}</span>}
                  {syncProgress.logsRead > 0 && (
                    <span>Rows read: {syncProgress.logsRead.toLocaleString()}</span>
                  )}
                  {syncProgress.punchesSent > 0 && (
                    <span>Mapped: {syncProgress.punchesSent.toLocaleString()}</span>
                  )}
                  {syncProgress.punchesInserted > 0 && (
                    <span>Inserted: ~{syncProgress.punchesInserted.toLocaleString()}</span>
                  )}
                </div>
              )}
              {syncProgress && syncProgress.lines.length > 0 && (
                <div
                  className="max-h-36 overflow-y-auto rounded border bg-background/80 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground"
                  aria-live="polite"
                >
                  {syncProgress.lines.map((line, i) => (
                    <div key={`${i}-${line}`}>{line}</div>
                  ))}
                </div>
              )}
              {syncProgress?.results && syncProgress.done && (
                <p className="text-xs text-foreground">{syncProgress.results.join(' · ')}</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Registered devices</CardTitle>
          <CardDescription>{rows.length} device(s)</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-12 grid place-items-center">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : rows.length === 0 ? (
            <div className="p-16 text-center text-sm text-muted-foreground">
              <HardDrive className="h-8 w-8 mx-auto mb-3 opacity-50" />
              No devices yet.
              {canManage && (
                <div className="mt-4">
                  <Button size="sm" onClick={openCreate}>
                    <Plus className="h-4 w-4" /> Register first device
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
                  <tr className="text-left">
                    <th className="px-6 py-3">Device</th>
                    <th className="px-3 py-3">Type</th>
                    <th className="px-3 py-3">Branch</th>
                    <th className="px-3 py-3">IP / Serial</th>
                    <th className="px-3 py-3">Last seen</th>
                    <th className="px-3 py-3">Last LAN sync</th>
                    <th className="px-3 py-3">Office agent</th>
                    <th className="px-3 py-3">Device LAN</th>
                    <th className="px-3 py-3">In HRM</th>
                    <th className="px-3 py-3 w-32"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((d) => {
                    const seen = lastSeenBadge(d.last_seen_at)
                    return (
                      <tr key={d.id} className="hover:bg-muted/20">
                        <td className="px-6 py-3">
                          <div className="font-medium">{d.name}</div>
                          {d.notes && <div className="text-xs text-muted-foreground truncate max-w-xs">{d.notes}</div>}
                        </td>
                        <td className="px-3 py-3">
                          <Badge variant="outline">{d.device_type}</Badge>
                        </td>
                        <td className="px-3 py-3 text-muted-foreground">{d.branches?.name ?? 'All'}</td>
                        <td className="px-3 py-3 text-xs font-mono text-muted-foreground">
                          {d.ip_address ?? '—'}
                          <br />
                          {d.serial_no ?? ''}
                        </td>
                        <td className="px-3 py-3">
                          <Badge variant={seen.variant}>
                            <Activity className="h-3 w-3" /> {seen.label}
                          </Badge>
                        </td>
                        <td className="px-3 py-3 text-xs max-w-[200px]">
                          {d.agent_last_sync_at ? (
                            <span title={d.agent_sync_notes ?? ''}>
                              {new Date(d.agent_last_sync_at).toLocaleString('en-PK', {
                                dateStyle: 'short',
                                timeStyle: 'short',
                              })}
                              {d.agent_sync_notes && (
                                <div className="text-muted-foreground truncate mt-0.5">{d.agent_sync_notes}</div>
                              )}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-3 py-3">
                          {heartbeatIsFresh(agentHeartbeat) ? (
                            <Badge variant="warm" title="Agent running on office PC">
                              Working
                            </Badge>
                          ) : (
                            <Badge variant="secondary" title="Start run-agent.ps1 on office PC">
                              Not working
                            </Badge>
                          )}
                        </td>
                        <td className="px-3 py-3 text-xs max-w-[220px]">
                          {(() => {
                            const live = lanStatus[d.id]
                            const ok = live?.connected ?? d.agent_connect_ok
                            const msg =
                              live?.message ??
                              d.agent_lan_message ??
                              (ok ? 'Connected' : d.agent_sync_notes) ??
                              ''
                            const checked = live != null || d.agent_connect_checked_at != null
                            if (!d.is_active) {
                              return <span className="text-muted-foreground">—</span>
                            }
                            if (!d.ip_address) {
                              return <span className="text-muted-foreground">No IP</span>
                            }
                            if (!heartbeatIsFresh(agentHeartbeat)) {
                              return (
                                <span className="text-muted-foreground">Waiting for office agent…</span>
                              )
                            }
                            if (!checked) {
                              return <span className="text-muted-foreground">Checking…</span>
                            }
                            return ok ? (
                              <div>
                                <Badge variant="warm">Connected</Badge>
                                {msg ? (
                                  <div className="text-muted-foreground mt-0.5 truncate" title={msg}>
                                    {msg}
                                  </div>
                                ) : null}
                              </div>
                            ) : (
                              <div>
                                <Badge variant="secondary">Not connected</Badge>
                                {msg ? (
                                  <div className="text-muted-foreground mt-0.5 truncate" title={msg}>
                                    {msg}
                                  </div>
                                ) : null}
                              </div>
                            )
                          })()}
                        </td>
                        <td className="px-3 py-3">
                          {d.is_active ? (
                            <Badge variant="warm">Active</Badge>
                          ) : (
                            <Badge variant="secondary">Disabled</Badge>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          {canManage && (
                            <div className="flex items-center gap-1">
                              <Button variant="ghost" size="sm" title="Edit" onClick={() => openEdit(d)}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                title={d.is_active ? 'Disable' : 'Enable'}
                                onClick={() => void toggleActive(d)}
                              >
                                {d.is_active ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
                              </Button>
                              <Button variant="ghost" size="sm" title="Delete" onClick={() => void onDelete(d)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4" />
            ZKT fetch logs (per device)
          </CardTitle>
          <CardDescription>
            Each agent pull is saved with punch-level detail: which rows were inserted, skipped as duplicate, unmapped
            PIN, capped, or before the sync cursor. Use this for live testing. Requires migration{' '}
            <span className="font-mono text-xs">0039_zkt_fetch_logs</span>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1 min-w-[200px]">
              <Label className="text-xs">Device</Label>
              <Select
                value={fetchLogDeviceId}
                onChange={(e) => {
                  const id = e.target.value
                  setFetchLogDeviceId(id)
                  void loadFetchLogs(id)
                }}
              >
                <option value="">Select device…</option>
                {rows
                  .filter((d) => d.device_type === 'ZKTeco' && d.is_active)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
              </Select>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={!fetchLogDeviceId || fetchLogLoading}
              onClick={() => void loadFetchLogs(fetchLogDeviceId)}
            >
              {fetchLogLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Refresh
            </Button>
          </div>

          {!fetchLogDeviceId ? (
            <p className="text-sm text-muted-foreground">Select a ZKTeco device to view fetch history.</p>
          ) : fetchRuns.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No fetch logs yet. Run the office agent and wait for the next 10s sync (or Pull from device).
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {fetchRuns.map((r) => (
                  <Button
                    key={r.id}
                    size="sm"
                    variant={selectedFetchRunId === r.id ? 'default' : 'outline'}
                    onClick={() => {
                      setSelectedFetchRunId(r.id)
                      void (async () => {
                        setFetchLogLoading(true)
                        const entriesRes = await supabase
                          .from('zkt_fetch_log_entries')
                          .select('id, run_id, device_pin, punch_at, outcome, reason')
                          .eq('run_id', r.id)
                          .order('punch_at', { ascending: true })
                          .limit(500)
                        setFetchEntries(
                          entriesRes.error ? [] : ((entriesRes.data ?? []) as FetchLogEntry[])
                        )
                        setFetchLogLoading(false)
                      })()
                    }}
                  >
                    {new Date(r.started_at).toLocaleString('en-PK', { dateStyle: 'short', timeStyle: 'short' })}
                    {r.success ? '' : ' · failed'}
                  </Button>
                ))}
              </div>

              {selectedFetchRunId ? (
                (() => {
                  const run = fetchRuns.find((r) => r.id === selectedFetchRunId)
                  if (!run) return null
                  return (
                    <div className="space-y-3">
                      <div className="text-sm flex flex-wrap gap-3">
                        <span>
                          Read: <strong>{run.logs_read}</strong>
                        </span>
                        <span>
                          Inserted: <strong className="text-emerald-600">{run.inserted_count}</strong>
                        </span>
                        <span>
                          Duplicates: <strong>{run.duplicate_count}</strong>
                        </span>
                        <span>
                          Skipped: <strong>{run.skipped_count}</strong>
                        </span>
                        {run.excluded_before_cursor > 0 ? (
                          <span>
                            Before cursor: <strong>{run.excluded_before_cursor}</strong>
                          </span>
                        ) : null}
                      </div>
                      {run.summary ? (
                        <p className="text-xs text-muted-foreground font-mono">{run.summary}</p>
                      ) : null}
                      {run.error_message ? (
                        <p className="text-xs text-destructive">{run.error_message}</p>
                      ) : null}
                      <div className="overflow-auto max-h-[min(360px,50vh)] border rounded-md">
                        <table className="w-full text-xs">
                          <thead className="bg-muted sticky top-0">
                            <tr className="text-left">
                              <th className="px-3 py-2">PIN</th>
                              <th className="px-3 py-2">Punch time</th>
                              <th className="px-3 py-2">Outcome</th>
                              <th className="px-3 py-2">Reason</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {fetchEntries.length === 0 ? (
                              <tr>
                                <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                                  No punch-level entries (empty pull or only summary rows).
                                </td>
                              </tr>
                            ) : (
                              fetchEntries.map((e) => (
                                <tr key={e.id} className="hover:bg-muted/30">
                                  <td className="px-3 py-2 font-mono">{e.device_pin ?? '—'}</td>
                                  <td className="px-3 py-2 whitespace-nowrap">
                                    {e.punch_at
                                      ? new Date(e.punch_at).toLocaleString('en-PK', {
                                          dateStyle: 'short',
                                          timeStyle: 'short',
                                        })
                                      : '—'}
                                  </td>
                                  <td className="px-3 py-2">
                                    <Badge variant={outcomeBadgeVariant(e.outcome)}>{e.outcome}</Badge>
                                  </td>
                                  <td className="px-3 py-2 text-muted-foreground">{e.reason}</td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )
                })()
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4" />
            Device PIN mapping (ZKTeco)
          </CardTitle>
          <CardDescription>
            Assign each employee to a <strong>specific device</strong> and <strong>PIN</strong> in Employees → edit
            (ZKTeco device + user ID). The agent loads every device IP from HRM and uses the PIN map for that machine
            only — so different branches can reuse the same PIN number on different devices.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid sm:grid-cols-3 gap-3 text-sm">
            <div className="rounded-lg border p-3 bg-muted/20">
              <div className="text-xs text-muted-foreground uppercase tracking-wide">Registered devices</div>
              <div className="text-2xl font-semibold mt-1">{rows.filter((d) => d.is_active).length}</div>
              <div className="text-xs text-muted-foreground mt-1">Admin → Devices (this page)</div>
            </div>
            <div className="rounded-lg border p-3 bg-muted/20">
              <div className="text-xs text-muted-foreground uppercase tracking-wide">Employees with PIN</div>
              <div className="text-2xl font-semibold mt-1">{mappedWithPin.length}</div>
              <div className="text-xs text-muted-foreground mt-1">
                <Link to="/employees" className="text-primary underline-offset-4 hover:underline">
                  Set PIN in Employees → edit
                </Link>
              </div>
            </div>
            <div className="rounded-lg border p-3 bg-muted/20">
              <div className="text-xs text-muted-foreground uppercase tracking-wide">Unmapped device PINs</div>
              <div className="text-2xl font-semibold mt-1">{unmappedPins.length}</div>
              <div className="text-xs text-muted-foreground mt-1">On device but no HRM employee</div>
            </div>
          </div>

          {unmappedPins.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
              <p className="font-medium text-amber-900 dark:text-amber-200">Punches not imported — no employee for these PINs</p>
              <p className="text-muted-foreground mt-1">
                Device user IDs:{' '}
                <span className="font-mono">{unmappedPins.join(', ')}</span>. In ZKTime, note the name for each ID,
                then in HRM open that employee, pick the <strong>ZKTeco device</strong>, and set the <strong>Device PIN</strong>.
              </p>
            </div>
          )}

          {missingPin.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {missingPin.length} active employee(s) have no Device PIN yet — they will not receive ZKTeco imports.
            </p>
          )}

          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
                <tr className="text-left">
                  <th className="px-4 py-3">Employee</th>
                  <th className="px-3 py-3">HRM code</th>
                  <th className="px-3 py-3">Device</th>
                  <th className="px-3 py-3">PIN</th>
                  <th className="px-3 py-3">Branch</th>
                  <th className="px-3 py-3">Last punch from device</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {devicePinRows.length === 0 && mappedWithPin.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                      No device assignments yet. Edit employees → ZKTeco device + PIN.
                    </td>
                  </tr>
                ) : devicePinRows.length > 0 ? (
                  devicePinRows.map((row) => {
                    const e = pinEmployees.find((p) => p.id === row.employee_id)
                    if (!e) return null
                    return (
                      <tr key={`${row.device_id}-${row.employee_id}`} className="hover:bg-muted/20">
                        <td className="px-4 py-3 font-medium">
                          <Link to={`/employees/${e.id}`} className="text-primary hover:underline">
                            {e.full_name}
                          </Link>
                        </td>
                        <td className="px-3 py-3 font-mono text-xs">{e.employee_code}</td>
                        <td className="px-3 py-3">{row.attendance_devices?.name ?? '—'}</td>
                        <td className="px-3 py-3">
                          <Badge variant="outline" className="font-mono">
                            {row.device_pin}
                          </Badge>
                        </td>
                        <td className="px-3 py-3 text-muted-foreground">{e.branches?.name ?? '—'}</td>
                        <td className="px-3 py-3 text-muted-foreground">
                          {lastDeviceByEmployee.get(e.id) ?? (
                            <span className="italic">No punch imported yet</span>
                          )}
                        </td>
                      </tr>
                    )
                  })
                ) : (
                  mappedWithPin.map((e) => (
                    <tr key={e.id} className="hover:bg-muted/20">
                      <td className="px-4 py-3 font-medium">
                        <Link to={`/employees/${e.id}`} className="text-primary hover:underline">
                          {e.full_name}
                        </Link>
                      </td>
                      <td className="px-3 py-3 font-mono text-xs">{e.employee_code}</td>
                      <td className="px-3 py-3 text-muted-foreground italic">Any (legacy)</td>
                      <td className="px-3 py-3">
                        <Badge variant="outline" className="font-mono">
                          {e.device_pin}
                        </Badge>
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">{e.branches?.name ?? '—'}</td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {lastDeviceByEmployee.get(e.id) ?? (
                          <span className="italic">No punch imported yet</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {unmappedPins.length > 0 && (
            <div className="overflow-x-auto rounded-lg border">
              <div className="px-4 py-2 text-xs font-medium uppercase text-muted-foreground bg-muted/30 border-b">
                Device PINs with no HRM employee
              </div>
              <table className="w-full text-sm">
                <thead className="bg-muted/20 text-xs uppercase text-muted-foreground">
                  <tr className="text-left">
                    <th className="px-4 py-2">Device PIN</th>
                    <th className="px-3 py-2">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {unmappedPins.map((pin) => {
                    const taken = pinByNumber.get(pin)
                    return (
                      <tr key={pin}>
                        <td className="px-4 py-2 font-mono">{pin}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {taken ? (
                            <span className="text-destructive">
                              Conflict: PIN already used by {taken.full_name} ({taken.employee_code})
                            </span>
                          ) : (
                            <Link to="/employees" className="text-primary hover:underline">
                              Find employee in ZKTime → set same PIN in HRM
                            </Link>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit device' : 'Register device'}</DialogTitle>
            <DialogDescription>
              The push token authenticates the device. Set the ZKTeco server URL to the push endpoint below.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2 sm:col-span-2">
                <Label>Name</Label>
                <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="HQ Reception ZK" />
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={form.device_type} onChange={(e) => setForm({ ...form, device_type: e.target.value })}>
                  {DEVICE_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Branch (optional)</Label>
                <Select value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })}>
                  <option value="">All branches</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Serial number</Label>
                <Input value={form.serial_no} onChange={(e) => setForm({ ...form, serial_no: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>IP address</Label>
                <Input value={form.ip_address} onChange={(e) => setForm({ ...form, ip_address: e.target.value })} placeholder="192.168.1.100" />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Push token</Label>
                <div className="flex gap-2">
                  <Input
                    value={form.push_token}
                    onChange={(e) => setForm({ ...form, push_token: e.target.value })}
                    className="font-mono text-xs"
                  />
                  <Button type="button" variant="outline" size="sm" onClick={() => setForm({ ...form, push_token: genToken() })}>
                    Regenerate
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => void copyToken(form.push_token)} disabled={!form.push_token}>
                    Copy
                  </Button>
                </div>
              </div>
              {form.push_token && form.device_type === 'ZKTeco' && (
                <div className="space-y-2 sm:col-span-2">
                  <Label>Push URL (ZKTeco server address)</Label>
                  <div className="flex gap-2">
                    <Input
                      readOnly
                      value={pushEndpointUrl(form.push_token, form.serial_no)}
                      className="font-mono text-[11px]"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void copyToken(pushEndpointUrl(form.push_token, form.serial_no))}
                    >
                      Copy
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    On the device: Communication → Cloud Server → set this URL. Employees need a matching Device PIN.
                  </p>
                </div>
              )}
              <div className="space-y-2 sm:col-span-2">
                <Label>Notes</Label>
                <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: !!v })} />
              Active
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
