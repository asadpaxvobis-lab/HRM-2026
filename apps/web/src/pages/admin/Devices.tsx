import { useEffect, useState } from 'react'
import {
  Plus,
  Pencil,
  RefreshCw,
  Loader2,
  HardDrive,
  Trash2,
  Activity,
  Power,
  PowerOff,
  Users,
  Cloud,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  genDevicePushToken,
  pushEndpointSplitFields,
} from '@/lib/zktPushUrl'
import {
  ADMS_DISCONNECT_NOTE,
  ADMS_TROUBLESHOOT_STEPS,
  admsConnectionStatus,
  formatRelative,
  lastSeenBadge,
  needsAdmsTroubleshooting,
} from '@/lib/admsDeviceStatus'
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
  push_token: string | null
  last_seen_at: string | null
  is_active: boolean
  notes: string | null
  branches?: { name: string } | null
}

type Branch = { id: string; name: string }

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

const DEVICE_TYPE_HINTS: Record<(typeof DEVICE_TYPES)[number], string> = {
  ZKTeco: 'Biometric terminal (K40, MB460 Plus, etc.) — copy the ADMS push URL onto the device.',
  'Face Kiosk': 'Face kiosk (coming soon).',
  Mobile: 'Mobile attendance app (coming soon).',
  Manual: 'No hardware — attendance entered manually in the Attendance screen.',
}

const isZkt = (type: string) => type === 'ZKTeco'

const emptyForm = {
  name: '',
  serial_no: '',
  device_type: 'ZKTeco',
  branch_id: '',
  push_token: '',
  is_active: true,
  notes: '',
}

function AdmsTroubleshootPanel({
  devices,
  lastPunchByDevice,
}: {
  devices: Device[]
  lastPunchByDevice: Map<string, string>
}) {
  const zkt = devices.filter((d) => isZkt(d.device_type) && d.is_active)
  const troubled = zkt.filter((d) => needsAdmsTroubleshooting(d, lastPunchByDevice.get(d.id)))
  if (troubled.length === 0) return null

  return (
    <Card className="border-amber-500/40 bg-amber-500/5">
      <CardHeader>
        <CardTitle className="text-base">Device keeps disconnecting?</CardTitle>
        <CardDescription>{ADMS_DISCONNECT_NOTE}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          {troubled.length} active ZKTeco device(s) are Stale, Offline, or Never connected:{' '}
          <strong>{troubled.map((d) => d.name).join(', ')}</strong>
        </p>
        <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
          {ADMS_TROUBLESHOOT_STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </CardContent>
    </Card>
  )
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
  const [zkPunchCount, setZkPunchCount] = useState<number | null>(null)
  const [lastPunchByDevice, setLastPunchByDevice] = useState<Map<string, string>>(new Map())
  const [punchCountByDevice, setPunchCountByDevice] = useState<Map<string, number>>(new Map())
  const [pinEmployees, setPinEmployees] = useState<PinEmployee[]>([])
  const [devicePinRows, setDevicePinRows] = useState<DevicePinRow[]>([])
  const [lastDeviceByEmployee, setLastDeviceByEmployee] = useState<Map<string, string>>(new Map())

  async function loadDevicesFromDb() {
    const selects = [
      'id, branch_id, name, serial_no, device_type, push_token, last_seen_at, is_active, notes, branches(name)',
      'id, branch_id, name, serial_no, device_type, push_token, last_seen_at, is_active, notes, branches(name)',
    ]
    let last = await supabase.from('attendance_devices').select(selects[0]).order('name')
    if (last.error?.message?.includes('does not exist')) {
      last = await supabase.from('attendance_devices').select(selects[1]).order('name')
    }
    return last
  }

  async function load() {
    setLoading(true)
    const d = await loadDevicesFromDb()
    const [b, p, emps, punches, devicePunches, edpRows] = await Promise.all([
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
      supabase
        .from('attendance_punches')
        .select('device_id, punch_at')
        .eq('source', 'zkteco')
        .not('device_id', 'is', null)
        .order('punch_at', { ascending: false })
        .limit(2000),
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

    const latestByDevice = new Map<string, string>()
    const countByDevice = new Map<string, number>()
    for (const row of devicePunches.data ?? []) {
      const rec = row as { device_id: string; punch_at: string }
      if (!rec.device_id) continue
      countByDevice.set(rec.device_id, (countByDevice.get(rec.device_id) ?? 0) + 1)
      if (!latestByDevice.has(rec.device_id)) latestByDevice.set(rec.device_id, rec.punch_at)
    }
    setLastPunchByDevice(latestByDevice)
    setPunchCountByDevice(countByDevice)

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
    const { count } = await supabase
      .from('attendance_punches')
      .select('id', { count: 'exact', head: true })
      .eq('source', 'zkteco')
    setZkPunchCount(count ?? 0)
    const devicePunches = await supabase
      .from('attendance_punches')
      .select('device_id, punch_at')
      .eq('source', 'zkteco')
      .not('device_id', 'is', null)
      .order('punch_at', { ascending: false })
      .limit(2000)
    const latestByDevice = new Map<string, string>()
    const countByDevice = new Map<string, number>()
    for (const row of devicePunches.data ?? []) {
      const rec = row as { device_id: string; punch_at: string }
      if (!rec.device_id) continue
      countByDevice.set(rec.device_id, (countByDevice.get(rec.device_id) ?? 0) + 1)
      if (!latestByDevice.has(rec.device_id)) latestByDevice.set(rec.device_id, rec.punch_at)
    }
    setLastPunchByDevice(latestByDevice)
    setPunchCountByDevice(countByDevice)
  }

  const mappedWithPin = pinEmployees.filter((e) => e.device_pin != null && e.device_pin > 0)
  const missingPin = pinEmployees.filter((e) => e.device_pin == null || e.device_pin <= 0)

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    const timer = setInterval(() => {
      void refreshDevicesQuiet()
    }, 10_000)
    return () => clearInterval(timer)
  }, [])

  const openCreate = () => {
    setEditing(null)
    setForm({ ...emptyForm, push_token: genDevicePushToken() })
    setOpen(true)
  }

  const isZktForm = isZkt(form.device_type)

  const openEdit = (d: Device) => {
    setEditing(d)
    setForm({
      name: d.name,
      serial_no: d.serial_no ?? '',
      device_type: d.device_type,
      branch_id: d.branch_id ?? '',
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
        description="Register ZKTeco terminals and configure ADMS cloud push to Supabase."
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
            {!canManage && (
              <span className="text-xs text-muted-foreground self-center">
                Need <code className="text-foreground">attendance.device</code> permission to register devices.
              </span>
            )}
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Cloud className="h-4 w-4" />
            ADMS cloud push
          </CardTitle>
          <CardDescription>
            ZKTeco devices upload punches directly to Supabase over HTTPS. Paste the push URL on the device
            (Menu → Comm → Cloud Server). Status refreshes every 10 seconds.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-4 text-sm">
          <span>
            ZKTeco punches in Supabase: <strong>{zkPunchCount ?? '—'}</strong>
          </span>
          <span>
            Active devices: <strong>{rows.filter((d) => d.is_active && isZkt(d.device_type)).length}</strong>
          </span>
          <Link to="/attendance" className="text-primary underline-offset-4 hover:underline">
            View attendance →
          </Link>
        </CardContent>
      </Card>

      <AdmsTroubleshootPanel devices={rows} lastPunchByDevice={lastPunchByDevice} />

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
                    <th className="px-3 py-3">Serial</th>
                    <th className="px-3 py-3">ADMS status</th>
                    <th className="px-3 py-3">Last handshake</th>
                    <th className="px-3 py-3">Punches</th>
                    <th className="px-3 py-3">In HRM</th>
                    <th className="px-3 py-3 w-32"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((d) => {
                    const seen = lastSeenBadge(d.last_seen_at)
                    const adms = isZkt(d.device_type)
                      ? admsConnectionStatus(d, lastPunchByDevice.get(d.id))
                      : null
                    const punchCount = punchCountByDevice.get(d.id) ?? 0
                    const lastPunch = lastPunchByDevice.get(d.id)
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
                        <td className="px-3 py-3 text-xs font-mono text-muted-foreground">{d.serial_no ?? '—'}</td>
                        <td className="px-3 py-3 text-xs max-w-[220px]">
                          {adms ? (
                            <div>
                              <Badge variant={adms.variant}>{adms.label}</Badge>
                              <div className="text-muted-foreground mt-0.5">{adms.detail}</div>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          {isZkt(d.device_type) ? (
                            <Badge variant={seen.variant}>
                              <Activity className="h-3 w-3" /> {seen.label}
                            </Badge>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-3 py-3 text-xs">
                          {isZkt(d.device_type) ? (
                            punchCount > 0 ? (
                              <span title={lastPunch ? new Date(lastPunch).toLocaleString('en-PK') : undefined}>
                                <strong>{punchCount}</strong>
                                {lastPunch ? (
                                  <div className="text-muted-foreground mt-0.5">
                                    Last {formatRelative(lastPunch)}
                                  </div>
                                ) : null}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">0</span>
                            )
                          ) : (
                            '—'
                          )}
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
            <Users className="h-4 w-4" />
            Device PIN mapping (ZKTeco)
          </CardTitle>
          <CardDescription>
            Assign each employee a <strong>Device PIN</strong> in Employees → edit. ADMS push matches the PIN on the
            terminal to the employee in HRM.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid sm:grid-cols-2 gap-3 text-sm">
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
          </div>

          {missingPin.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {missingPin.length} active employee(s) have no Device PIN yet — ADMS punches for those PINs will not import.
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
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit device' : 'Register device manually'}</DialogTitle>
            <DialogDescription>
              {isZktForm
                ? 'Enter device details and copy the ADMS push URL onto the terminal.'
                : 'Register a non-ZKT source. Manual type is for hand-entered attendance only — no sync from hardware.'}
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2 sm:col-span-2">
                <Label>Device name *</Label>
                <Input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. ZKT MB460 Plus — Main gate"
                />
              </div>
              <div className="space-y-2">
                <Label>Device type *</Label>
                <Select
                  value={form.device_type}
                  onChange={(e) => {
                    const device_type = e.target.value
                    setForm({
                      ...form,
                      device_type,
                      push_token: isZkt(device_type) ? form.push_token || genDevicePushToken() : '',
                    })
                  }}
                >
                  {DEVICE_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </Select>
                <p className="text-xs text-muted-foreground">
                  {DEVICE_TYPE_HINTS[form.device_type as (typeof DEVICE_TYPES)[number]] ?? ''}
                </p>
              </div>
              <div className="space-y-2">
                <Label>Branch</Label>
                <Select value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })}>
                  <option value="">All branches</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </Select>
              </div>
              {isZktForm && (
                <div className="space-y-2 sm:col-span-2">
                  <Label>Serial number</Label>
                  <Input
                    value={form.serial_no}
                    onChange={(e) => setForm({ ...form, serial_no: e.target.value })}
                    placeholder="e.g. TTq5253800196"
                  />
                  <p className="text-xs text-muted-foreground">From device menu → System → Device info</p>
                </div>
              )}
              {isZktForm && editing && (() => {
                const live = rows.find((r) => r.id === editing.id) ?? editing
                const adms = admsConnectionStatus(live, lastPunchByDevice.get(live.id))
                const punches = punchCountByDevice.get(live.id) ?? 0
                return (
                  <div className="space-y-2 sm:col-span-2 rounded-lg border bg-background p-3">
                    <p className="text-xs font-medium text-foreground flex items-center gap-2">
                      <Cloud className="h-3.5 w-3.5" />
                      Supabase ADMS connection
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={adms.variant}>{adms.label}</Badge>
                      {live.last_seen_at ? (
                        <span className="text-xs text-muted-foreground">
                          Last handshake {formatRelative(live.last_seen_at)}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs text-muted-foreground">{adms.detail}</p>
                    <p className="text-xs text-muted-foreground">
                      Punches in Supabase from this device: <strong>{punches}</strong>
                    </p>
                  </div>
                )
              })()}
              {isZktForm && (
                <div className="space-y-2 sm:col-span-2 rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs font-medium text-foreground">ADMS cloud push</p>
                  <Label className="text-xs">Push token</Label>
                  <div className="flex gap-2">
                    <Input
                      value={form.push_token}
                      onChange={(e) => setForm({ ...form, push_token: e.target.value })}
                      className="font-mono text-xs"
                    />
                    <Button type="button" variant="outline" size="sm" onClick={() => setForm({ ...form, push_token: genDevicePushToken() })}>
                      Regenerate
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => void copyToken(form.push_token)} disabled={!form.push_token}>
                      Copy
                    </Button>
                  </div>
                  {form.push_token && (() => {
                    const split = pushEndpointSplitFields(form.push_token, form.serial_no)
                    const shortUrl = split.fullUrl
                    return (
                      <>
                        <Label className="text-xs">Short push URL — paste on device</Label>
                        <div className="flex gap-2">
                          <Input readOnly value={shortUrl} className="font-mono text-[11px]" />
                          <Button type="button" variant="outline" size="sm" onClick={() => void copyToken(shortUrl)}>
                            Copy URL
                          </Button>
                        </div>
                        <p className="text-[11px] text-muted-foreground">{shortUrl.length} characters</p>
                        <div className="rounded border bg-background/80 p-2 space-y-2 text-[11px]">
                          <p className="font-medium text-foreground">Or split on device (MB460 Cloud Server)</p>
                          <div className="grid gap-1 sm:grid-cols-2">
                            <div>
                              <span className="text-muted-foreground">Server: </span>
                              <span className="font-mono">{split.server}</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Port: </span>
                              <span className="font-mono">{split.port}</span>
                            </div>
                            <div className="sm:col-span-2">
                              <span className="text-muted-foreground">HTTPS: </span>
                              <span>On</span>
                            </div>
                            <div className="sm:col-span-2">
                              <span className="text-muted-foreground">Path: </span>
                              <span className="font-mono break-all">{split.path}</span>
                            </div>
                          </div>
                          <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => void copyToken(split.path)}>
                            Copy path only
                          </Button>
                        </div>
                        <ol className="text-xs text-muted-foreground list-decimal list-inside space-y-1 mt-2">
                          <li>On device: Menu → Comm → Cloud Server → ADMS</li>
                          <li>Enable domain name, HTTPS on, port 443</li>
                          <li>Paste short URL or use split server + path above</li>
                          <li>Save, reboot device, then punch — punches appear here via ADMS</li>
                        </ol>
                      </>
                    )
                  })()}
                </div>
              )}
              <div className="space-y-2 sm:col-span-2">
                <Label>Notes</Label>
                <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Location, model, etc." />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: !!v })} />
              Active
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
