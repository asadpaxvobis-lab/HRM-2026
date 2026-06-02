import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Loader2, Plus, RefreshCw, Search, Activity, Calendar, Clock, Pencil } from 'lucide-react'
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
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { avatarColorFor, initialsFromName, cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import {
  recomputeAttendanceDaily,
  fmtMinutes,
  computeAttendanceMetrics,
  displayOvertimeMinutes,
  isoToLocalDatetimeInput,
  localDatetimeInputToIso,
  metricsFromEditTimes,
  formatShiftWindow,
  isCompleteDatetimeLocal,
  saveManualAttendanceDay,
  dateFromEditInputs,
} from '@/lib/attendance'
import { toCsv, downloadCsv } from '@/lib/csv'

type Daily = {
  id: string
  employee_id: string
  attendance_date: string
  status: string
  first_in: string | null
  last_out: string | null
  worked_minutes: number
  late_minutes: number
  early_out_minutes: number
  overtime_minutes: number
  is_weekly_off: boolean
  is_holiday: boolean
  scheduled_start?: string | null
  scheduled_end?: string | null
  notes?: string | null
  shifts?: {
    code: string
    name: string
    start_time?: string
    end_time?: string
    break_minutes?: number
    grace_late_minutes?: number
    grace_early_minutes?: number
    is_night?: boolean
  } | null
}

function metricsFor(d: Daily | undefined, dateStr: string) {
  if (!d?.first_in) {
    return {
      worked_minutes: 0,
      late_minutes: 0,
      early_out_minutes: 0,
      overtime_minutes: 0,
      gross_overtime_minutes: 0,
    }
  }
  return computeAttendanceMetrics(
    dateStr,
    d.first_in,
    d.last_out,
    d.shifts,
    d.scheduled_start,
    d.scheduled_end
  )
}

const ATTENDANCE_STATUSES = ['Present', 'Late', 'Half Day', 'Absent', 'Leave', 'Holiday', 'Weekly Off']

type Employee = {
  id: string
  employee_code: string
  full_name: string
  branch_id: string | null
  department_id: string | null
  branches?: { name: string } | null
  departments?: { name: string } | null
}

type Branch = { id: string; name: string }
type Department = { id: string; name: string }

const today = () => new Date().toISOString().slice(0, 10)

const statusVariant = (s: string): 'warm' | 'outline' | 'secondary' => {
  if (s === 'Present') return 'warm'
  if (s === 'Late' || s === 'Half Day') return 'warm'
  if (s === 'Holiday' || s === 'Weekly Off' || s === 'Leave') return 'secondary'
  return 'outline'
}

const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', hour12: true }) : '—'

const statusTableThClass =
  'sticky top-0 z-10 bg-muted px-3 py-3 border-b border-border shadow-[0_1px_0_0_hsl(var(--border))]'

function CompulsoryColumnHeader({ label, className }: { label: string; className?: string }) {
  return (
    <th className={cn(statusTableThClass, className)}>
      {label} <span className="text-destructive font-bold">*</span>
    </th>
  )
}

function CompulsoryField({
  label,
  children,
  className,
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('space-y-2', className)}>
      <Label>
        {label} <span className="text-destructive font-bold">*</span>
      </Label>
      {children}
    </div>
  )
}

/** Working day rows where in/out punches are expected (not leave, holiday, or weekly off). */
function expectsPunches(status: string, d?: Daily) {
  if (d?.is_holiday || d?.is_weekly_off) return false
  if (['Leave', 'Holiday', 'Weekly Off'].includes(status)) return false
  return true
}

function rowMetrics(d: Daily | undefined, dateStr: string) {
  const computed = metricsFor(d, dateStr)
  if (!d?.first_in) return computed
  const status = d.status ?? 'Absent'
  // Working days: late → Late column, net OT → Overtime column (from in/out + shift).
  if (expectsPunches(status, d)) return computed
  const late = d.late_minutes ?? computed.late_minutes
  const grossOt = d.overtime_minutes ?? computed.overtime_minutes
  return {
    worked_minutes: d.worked_minutes ?? computed.worked_minutes,
    late_minutes: late,
    early_out_minutes: d.early_out_minutes ?? computed.early_out_minutes,
    overtime_minutes: displayOvertimeMinutes({
      overtime_minutes: grossOt,
      late_minutes: late,
      gross_overtime_minutes: grossOt,
    }),
  }
}

/** Plain minute count for Late / Overtime table columns. */
function minutesColumnValue(minutes: number, show: boolean): string {
  if (!show) return '—'
  return String(Math.max(0, Math.round(minutes)))
}

function getDisplayStatus(d: Daily | undefined, dateStr: string): string {
  const status = d?.status ?? 'Absent'
  const m = rowMetrics(d, dateStr)
  if (d?.first_in && status === 'Present' && m.late_minutes > 0) return 'Late'
  return status
}

export function AttendancePage() {
  const { appUser, hasPermission } = useAuth()
  const canCreate = hasPermission('attendance.create')
  const canUpdate = hasPermission('attendance.update')
  const [date, setDate] = useState(today())
  const [rows, setRows] = useState<Daily[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [branchFilter, setBranchFilter] = useState('')
  const [deptFilter, setDeptFilter] = useState('')
  const [punchOpen, setPunchOpen] = useState(false)
  const [punchForm, setPunchForm] = useState({
    employee_id: '',
    punch_at: '',
    punch_type: 'in',
    notes: '',
  })

  const [editOpen, setEditOpen] = useState(false)
  const [editShift, setEditShift] = useState<Daily['shifts']>(null)
  const [editTarget, setEditTarget] = useState<Employee | null>(null)
  const [editForm, setEditForm] = useState({
    id: '' as string | null,
    status: 'Present',
    first_in: '',
    last_out: '',
    worked_minutes: 0,
    late_minutes: 0,
    early_out_minutes: 0,
    overtime_minutes: 0,
    is_holiday: false,
    is_weekly_off: false,
    notes: '',
  })

  async function load() {
    setLoading(true)
    const [emp, br, dp, daily] = await Promise.all([
      supabase
        .from('employees')
        .select('id, employee_code, full_name, branch_id, department_id, branches(name), departments(name)')
        .eq('is_active', true)
        .order('full_name'),
      supabase.from('branches').select('id, name').eq('is_active', true).order('name'),
      supabase.from('departments').select('id, name').eq('is_active', true).order('name'),
      supabase
        .from('attendance_daily')
        .select(
          'id, employee_id, attendance_date, status, first_in, last_out, worked_minutes, late_minutes, early_out_minutes, overtime_minutes, is_weekly_off, is_holiday, scheduled_start, scheduled_end, notes, shifts(code, name, start_time, end_time, break_minutes, grace_late_minutes, grace_early_minutes, is_night)'
        )
        .eq('attendance_date', date),
    ])
    if (emp.data) {
      const list = emp.data.map((r: Record<string, unknown>) => {
        const b = r.branches
        const d = r.departments
        return { ...r, branches: Array.isArray(b) ? b[0] : b, departments: Array.isArray(d) ? d[0] : d } as Employee
      })
      setEmployees(list)
    }
    setBranches((br.data ?? []) as Branch[])
    setDepartments((dp.data ?? []) as Department[])
    if (daily.data) {
      const dailyRows = daily.data.map((r: Record<string, unknown>) => {
        const sh = r.shifts
        return { ...r, shifts: Array.isArray(sh) ? sh[0] : sh } as Daily
      })
      setRows(dailyRows)
    }
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [date])

  const byEmployee = useMemo(() => {
    const map = new Map<string, Daily>()
    for (const r of rows) map.set(r.employee_id, r)
    return map
  }, [rows])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return employees.filter((e) => {
      if (branchFilter && e.branch_id !== branchFilter) return false
      if (deptFilter && e.department_id !== deptFilter) return false
      if (q && !e.full_name.toLowerCase().includes(q) && !e.employee_code.toLowerCase().includes(q)) return false
      return true
    })
  }, [employees, query, branchFilter, deptFilter])

  const counts = useMemo(() => {
    const acc: Record<string, number> = { Present: 0, Late: 0, Absent: 0, Leave: 0, 'Weekly Off': 0, Holiday: 0, 'Half Day': 0 }
    for (const e of filtered) {
      const d = byEmployee.get(e.id)
      const s = getDisplayStatus(d, date)
      acc[s] = (acc[s] ?? 0) + 1
    }
    return acc
  }, [filtered, byEmployee, date])

  const statusGroups = useMemo(() => {
    const present: Employee[] = []
    const late: Employee[] = []
    const absent: Employee[] = []
    for (const e of filtered) {
      const status = getDisplayStatus(byEmployee.get(e.id), date)
      if (status === 'Present') present.push(e)
      else if (status === 'Late') late.push(e)
      else if (status === 'Absent') absent.push(e)
    }
    return { present, late, absent }
  }, [filtered, byEmployee, date])

  const onRecompute = async () => {
    if (!appUser) return
    setBusy(true)
    try {
      const res = await recomputeAttendanceDaily(appUser.company_id, date)
      await writeAuditLog({ action: 'UPDATE', entityType: 'attendance_recompute', after: { date, rows: res.rows } })
      toast.success(`Re-aggregated ${res.rows} employee(s) for ${date}`)
      void load()
    } catch (err) {
      toast.error('Recompute failed', { description: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const openPunch = () => {
    const now = new Date()
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
    setPunchForm({ employee_id: '', punch_at: local, punch_type: 'in', notes: '' })
    setPunchOpen(true)
  }

  const openEdit = async (emp: Employee) => {
    const d = byEmployee.get(emp.id)
    let shift = d?.shifts ?? null
    if (!shift?.start_time) {
      const { data: asn } = await supabase
        .from('employee_shift_assignments')
        .select(
          'shifts(code, name, start_time, end_time, break_minutes, grace_late_minutes, grace_early_minutes, is_night)'
        )
        .eq('employee_id', emp.id)
        .lte('effective_from', date)
        .or(`effective_to.is.null,effective_to.gte.${date}`)
        .order('effective_from', { ascending: false })
        .limit(1)
        .maybeSingle()
      const sh = (asn as { shifts?: Daily['shifts'] } | null)?.shifts
      shift = Array.isArray(sh) ? sh[0] : sh ?? null
    }
    setEditShift(shift)
    const firstIn = isoToLocalDatetimeInput(d?.first_in ?? null)
    const lastOut = isoToLocalDatetimeInput(d?.last_out ?? null)
    const m = metricsFromEditTimes(date, firstIn, lastOut, shift)
    setEditTarget(emp)
    const openStatus =
      d?.status && !['Absent', 'Leave', 'Holiday', 'Weekly Off'].includes(d.status) ? d.status : 'Present'
    setEditForm({
      id: d?.id ?? null,
      status: openStatus,
      first_in: firstIn,
      last_out: lastOut,
      worked_minutes: m.worked_minutes,
      late_minutes: m.late_minutes,
      early_out_minutes: m.early_out_minutes,
      overtime_minutes: m.overtime_minutes,
      is_holiday: d?.is_holiday ?? false,
      is_weekly_off: d?.is_weekly_off ?? false,
      notes: d?.notes ?? '',
    })
    setEditOpen(true)
  }

  const workingEditStatus = ['Present', 'Late', 'Half Day'].includes(editForm.status)

  const shiftForEdit =
    editShift ?? (editTarget ? byEmployee.get(editTarget.id)?.shifts : null) ?? null

  const applyEditTimes = (first_in: string, last_out: string) => {
    if (!isCompleteDatetimeLocal(first_in)) {
      return { worked_minutes: 0, late_minutes: 0, early_out_minutes: 0, overtime_minutes: 0 }
    }
    return metricsFromEditTimes(date, first_in, last_out, shiftForEdit)
  }

  const patchEditTimes = (patch: { first_in?: string; last_out?: string }) => {
    setEditForm((f) => {
      const first_in = patch.first_in ?? f.first_in
      const last_out = patch.last_out ?? f.last_out
      return { ...f, first_in, last_out, ...applyEditTimes(first_in, last_out) }
    })
  }

  const submitEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!appUser || !editTarget) return
    const needsPunches = ['Present', 'Late', 'Half Day'].includes(editForm.status)
    if (needsPunches && !editForm.first_in.trim()) {
      toast.error('First in is required for this status')
      return
    }
    if (needsPunches && !editForm.last_out.trim()) {
      toast.error('Last out is required for this status')
      return
    }
    setBusy(true)
    const firstIso = localDatetimeInputToIso(editForm.first_in)
    const lastIso = localDatetimeInputToIso(editForm.last_out)
    const attendanceDate = dateFromEditInputs(editForm.first_in, editForm.last_out, date)

    let dailyId: string | undefined = editForm.id ?? undefined
    let saveError: string | undefined

    if (firstIso) {
      const result = await saveManualAttendanceDay({
        employeeId: editTarget.id,
        date: attendanceDate,
        firstInIso: firstIso,
        lastOutIso: lastIso,
        status: editForm.status,
        notes: editForm.notes.trim() || null,
        isHoliday: editForm.is_holiday,
        isWeeklyOff: editForm.is_weekly_off,
      })
      saveError = result.error
      dailyId = result.dailyId ?? dailyId
    } else {
      const payload: Record<string, unknown> = {
        company_id: appUser.company_id,
        employee_id: editTarget.id,
        attendance_date: attendanceDate,
        status: editForm.status,
        first_in: null,
        last_out: null,
        worked_minutes: 0,
        late_minutes: 0,
        early_out_minutes: 0,
        overtime_minutes: 0,
        is_holiday: editForm.is_holiday,
        is_weekly_off: editForm.is_weekly_off,
        notes: editForm.notes.trim() || null,
      }
      const res = editForm.id
        ? await supabase.from('attendance_daily').update(payload).eq('id', editForm.id).select('id').single()
        : await supabase.from('attendance_daily').insert(payload).select('id').single()
      if (res.error) saveError = res.error.message
      else dailyId = res.data?.id
    }

    setBusy(false)
    if (saveError) {
      toast.error('Could not save attendance', { description: saveError })
      return
    }
    await writeAuditLog({
      action: editForm.id ? 'UPDATE' : 'CREATE',
      entityType: 'attendance_daily',
      entityId: dailyId,
      after: {
        employee_id: editTarget.id,
        attendance_date: attendanceDate,
        status: editForm.status,
        first_in: firstIso,
        last_out: lastIso,
      },
    })
    toast.success('Attendance saved', {
      description: firstIso ? 'Late and overtime recalculated from shift.' : undefined,
    })
    setEditOpen(false)
    void load()
  }

  const submitPunch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!appUser) return
    setBusy(true)
    const payload = {
      company_id: appUser.company_id,
      employee_id: punchForm.employee_id,
      punch_at: new Date(punchForm.punch_at).toISOString(),
      punch_type: punchForm.punch_type,
      source: 'manual',
      notes: punchForm.notes.trim() || null,
      created_by: appUser.id,
    }
    const { data, error } = await supabase.from('attendance_punches').insert(payload).select('id').single()
    if (error) {
      setBusy(false)
      toast.error('Could not record punch', { description: error.message })
      return
    }
    await writeAuditLog({ action: 'CREATE', entityType: 'attendance_punch', entityId: data?.id, after: payload })
    const punchDate = new Date(punchForm.punch_at).toISOString().slice(0, 10)
    const { error: recomputeErr } = await supabase.rpc('recompute_attendance_for_employee', {
      p_employee_id: punchForm.employee_id,
      p_date: punchDate,
    })
    setPunchOpen(false)
    setBusy(false)
    if (recomputeErr) {
      toast.warning('Punch saved; re-aggregate failed', { description: recomputeErr.message })
    } else {
      toast.success('Punch recorded — late & OT updated')
    }
    void load()
  }

  const exportDay = () => {
    const data = filtered.map((e) => {
      const d = byEmployee.get(e.id)
      const m = rowMetrics(d, date)
      const displayStatus = getDisplayStatus(d, date)
      return {
        employee_code: e.employee_code,
        full_name: e.full_name,
        branch: e.branches?.name ?? '',
        department: e.departments?.name ?? '',
        status: displayStatus,
        first_in: d?.first_in ? new Date(d.first_in).toLocaleString('en-PK') : '',
        last_out: d?.last_out ? new Date(d.last_out).toLocaleString('en-PK') : '',
        worked_minutes: m.worked_minutes,
        late_minutes: m.late_minutes,
        early_out_minutes: m.early_out_minutes,
        overtime_minutes: m.overtime_minutes,
      }
    })
    downloadCsv(`attendance-${date}.csv`, toCsv(data))
    toast.success('Exported')
  }

  const renderStatusTable = (title: string, people: Employee[]) => (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          {title} ({people.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {people.length === 0 ? (
          <div className="px-6 pb-6 text-sm text-muted-foreground">No employees in this status.</div>
        ) : (
          <div className="overflow-auto max-h-[min(420px,55vh)] border-t isolate">
            <table className="w-full text-sm border-collapse">
              <thead className="text-xs uppercase text-muted-foreground">
                <tr className="text-left">
                  <th className={cn(statusTableThClass, 'px-6')}>Employee</th>
                  <th className={statusTableThClass}>Shift</th>
                  <th className={statusTableThClass}>Status</th>
                  <CompulsoryColumnHeader label="In" />
                  <CompulsoryColumnHeader label="Out" />
                  <CompulsoryColumnHeader label="Worked" />
                  <CompulsoryColumnHeader label="Late (minutes)" />
                  <CompulsoryColumnHeader label="Overtime (hours)" />
                  {canUpdate && <th className={cn(statusTableThClass, 'w-10')}></th>}
                </tr>
              </thead>
              <tbody className="divide-y">
                {people.map((e) => {
                  const d = byEmployee.get(e.id)
                  const m = rowMetrics(d, date)
                  const displayStatus = getDisplayStatus(d, date)
                  return (
                    <tr key={e.id} className="hover:bg-muted/20">
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className={avatarColorFor(e.employee_code)}>
                              {initialsFromName(e.full_name)}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <div className="font-medium">{e.full_name}</div>
                            <div className="text-xs text-muted-foreground">{e.employee_code}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-xs">
                        {d?.shifts?.code ? (
                          <span className="text-muted-foreground" title={d.shifts.name}>
                            {d.shifts.code}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/60 italic">No shift</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <Badge variant={statusVariant(displayStatus)}>{displayStatus}</Badge>
                      </td>
                      <td className="px-3 py-3 tabular-nums">
                        {fmtTime(d?.first_in ?? null)}
                      </td>
                      <td className="px-3 py-3 tabular-nums">
                        {fmtTime(d?.last_out ?? null)}
                      </td>
                      <td className="px-3 py-3 tabular-nums">{fmtMinutes(m.worked_minutes, true)}</td>
                      <td className="px-3 py-3 tabular-nums">
                        <span className={m.late_minutes > 0 ? 'font-medium' : undefined}>
                          {minutesColumnValue(m.late_minutes, !!d?.first_in)}
                        </span>
                      </td>
                      <td className="px-3 py-3 tabular-nums">
                        <span className={m.overtime_minutes > 0 ? 'text-emerald-600 dark:text-emerald-400 font-medium' : undefined}>
                          {d?.first_in ? fmtMinutes(m.overtime_minutes, true) : '—'}
                        </span>
                      </td>
                      {canUpdate && (
                        <td className="px-3 py-3">
                          <Button variant="ghost" size="sm" onClick={() => void openEdit(e)} title="Edit attendance">
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance"
        description="Daily attendance from devices and manual punches. Aggregates can be re-computed on demand."
        actions={
          <>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" />
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <HasPermission perm="attendance.export">
              <Button variant="outline" size="sm" onClick={exportDay} disabled={filtered.length === 0}>
                Export CSV
              </Button>
            </HasPermission>
            <HasPermission perm="attendance.update">
              <Button variant="outline" size="sm" onClick={onRecompute} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
                Re-aggregate
              </Button>
            </HasPermission>
            <HasPermission perm="attendance.create">
              <Button size="sm" onClick={openPunch}>
                <Plus className="h-4 w-4" /> Manual punch
              </Button>
            </HasPermission>
          </>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {Object.entries(counts).map(([k, v]) => (
          <Card key={k}>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground uppercase tracking-wider">{k}</div>
              <div className="text-2xl font-semibold tabular-nums">{v}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search employee" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <Select className="w-44" value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
              <option value="">All branches</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </Select>
            <Select className="w-44" value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <p className="px-6 py-2 text-xs text-muted-foreground border-b bg-muted/20">
            Columns marked <span className="text-destructive font-bold">*</span> are required for working-day attendance.
            Columns marked * are required for working-day attendance. Overtime is after shift end, minus late minutes.
          </p>
          {loading ? (
            <div className="p-16 grid place-items-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-16 text-center text-sm text-muted-foreground">
              <Calendar className="h-8 w-8 mx-auto mb-3 opacity-50" />
              No employees match the current filters.
            </div>
          ) : (
            <div className="space-y-4 p-4">
              {renderStatusTable('Present', statusGroups.present)}
              {renderStatusTable('Late', statusGroups.late)}
              {renderStatusTable('Absent', statusGroups.absent)}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={editOpen}
        onOpenChange={(open) => {
          setEditOpen(open)
          if (!open) setEditShift(null)
        }}
      >
        <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit attendance</DialogTitle>
            <DialogDescription>
              {editTarget?.full_name} ({editTarget?.employee_code}) · {date}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitEdit} className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Status</Label>
                <Select
                  value={editForm.status}
                  onChange={(e) => {
                    const status = e.target.value
                    setEditForm((f) => {
                      const next = { ...f, status }
                      if (!isCompleteDatetimeLocal(f.first_in)) return next
                      return { ...next, ...applyEditTimes(f.first_in, f.last_out) }
                    })
                  }}
                >
                  {ATTENDANCE_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Notes</Label>
                <Input
                  value={editForm.notes}
                  onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                  placeholder="Reason / context"
                />
              </div>
              <p className="sm:col-span-2 text-xs text-muted-foreground">
                Shift for calculation: <span className="font-medium text-foreground">{formatShiftWindow(shiftForEdit)}</span>
              </p>
              {['Present', 'Late', 'Half Day'].includes(editForm.status) ? (
                <>
                  <CompulsoryField label="First in (date & time)">
                    <Input
                      type="datetime-local"
                      required
                      value={editForm.first_in}
                      onChange={(e) => patchEditTimes({ first_in: e.target.value })}
                      onInput={(e) => patchEditTimes({ first_in: e.currentTarget.value })}
                    />
                  </CompulsoryField>
                  <CompulsoryField label="Last out (date & time)">
                    <Input
                      type="datetime-local"
                      required
                      value={editForm.last_out}
                      onChange={(e) => patchEditTimes({ last_out: e.target.value })}
                      onInput={(e) => patchEditTimes({ last_out: e.currentTarget.value })}
                    />
                  </CompulsoryField>
                </>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label>First in (date & time)</Label>
                    <Input
                      type="datetime-local"
                      value={editForm.first_in}
                      onChange={(e) => patchEditTimes({ first_in: e.target.value })}
                      onInput={(e) => patchEditTimes({ first_in: e.currentTarget.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Last out (date & time)</Label>
                    <Input
                      type="datetime-local"
                      value={editForm.last_out}
                      onChange={(e) => patchEditTimes({ last_out: e.target.value })}
                      onInput={(e) => patchEditTimes({ last_out: e.currentTarget.value })}
                    />
                  </div>
                </>
              )}
              <CompulsoryField label="Late (minutes)">
                <Input
                  type="number"
                  min={0}
                  required
                  readOnly={workingEditStatus}
                  value={editForm.late_minutes}
                  className={workingEditStatus ? 'bg-muted/50 cursor-default' : undefined}
                  onChange={(e) => setEditForm({ ...editForm, late_minutes: Number(e.target.value) })}
                />
                <div className="text-[11px] text-muted-foreground">
                  {isCompleteDatetimeLocal(editForm.first_in)
                    ? `Auto: ${editForm.late_minutes} min late`
                    : 'Set first in to calculate'}
                </div>
              </CompulsoryField>
              <CompulsoryField label="Overtime (minutes)">
                <Input
                  type="number"
                  min={0}
                  required
                  readOnly={workingEditStatus}
                  value={editForm.overtime_minutes}
                  className={workingEditStatus ? 'bg-muted/50 cursor-default' : undefined}
                  onChange={(e) => setEditForm({ ...editForm, overtime_minutes: Number(e.target.value) })}
                />
                <div className="text-[11px] text-muted-foreground">
                  {isCompleteDatetimeLocal(editForm.first_in)
                    ? `Auto: ${editForm.overtime_minutes} min (after shift − late)`
                    : 'Set in/out times to calculate'}
                </div>
              </CompulsoryField>
              <CompulsoryField label="Worked (minutes)">
                <Input
                  type="number"
                  min={0}
                  required
                  readOnly={workingEditStatus}
                  value={editForm.worked_minutes}
                  className={workingEditStatus ? 'bg-muted/50 cursor-default' : undefined}
                  onChange={(e) => setEditForm({ ...editForm, worked_minutes: Number(e.target.value) })}
                />
                <div className="text-[11px] text-muted-foreground">
                  {fmtMinutes(Number(editForm.worked_minutes) || 0, true)}
                </div>
              </CompulsoryField>
              <div className="space-y-2">
                <Label>Early out (minutes)</Label>
                <Input
                  type="number"
                  min={0}
                  readOnly={workingEditStatus}
                  value={editForm.early_out_minutes}
                  className={workingEditStatus ? 'bg-muted/50 cursor-default' : undefined}
                  onChange={(e) => setEditForm({ ...editForm, early_out_minutes: Number(e.target.value) })}
                />
                <div className="text-[11px] text-muted-foreground">
                  {fmtMinutes(Number(editForm.early_out_minutes) || 0, true)}
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm sm:col-span-1">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={editForm.is_holiday}
                  onChange={(e) => setEditForm({ ...editForm, is_holiday: e.target.checked })}
                />
                Mark as holiday
              </label>
              <label className="flex items-center gap-2 text-sm sm:col-span-1">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={editForm.is_weekly_off}
                  onChange={(e) => setEditForm({ ...editForm, is_weekly_off: e.target.checked })}
                />
                Mark as weekly off
              </label>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Tip: Re-aggregate will overwrite these manual values. Use the notes field to flag overrides.
            </p>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={punchOpen} onOpenChange={setPunchOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add manual punch</DialogTitle>
            <DialogDescription>
              Manual punches are audit-logged. Daily aggregate refreshes automatically.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitPunch} className="space-y-4">
            <CompulsoryField label="Employee">
              <Select
                value={punchForm.employee_id}
                onChange={(e) => setPunchForm({ ...punchForm, employee_id: e.target.value })}
                required
              >
                <option value="">Select employee</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.employee_code} — {e.full_name}
                  </option>
                ))}
              </Select>
            </CompulsoryField>
            <div className="grid sm:grid-cols-2 gap-4">
              <CompulsoryField label="Punch time">
                <Input
                  type="datetime-local"
                  required
                  value={punchForm.punch_at}
                  onChange={(e) => setPunchForm({ ...punchForm, punch_at: e.target.value })}
                />
              </CompulsoryField>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={punchForm.punch_type} onChange={(e) => setPunchForm({ ...punchForm, punch_type: e.target.value })}>
                  <option value="in">Check-in</option>
                  <option value="out">Check-out</option>
                  <option value="auto">Auto (decide on aggregate)</option>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Input value={punchForm.notes} onChange={(e) => setPunchForm({ ...punchForm, notes: e.target.value })} placeholder="Optional reason / context" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPunchOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock className="h-4 w-4" />}
                Save punch
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
