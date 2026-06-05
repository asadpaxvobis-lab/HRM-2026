import { useEffect, useMemo, useState } from 'react'
import { Loader2, RefreshCw, Search } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { PageHeader } from '@/components/master/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { avatarColorFor, initialsFromName, cn } from '@/lib/utils'
import { toCsv, downloadCsv } from '@/lib/csv'
import { resolveInOutFromPunches } from '@/lib/attendance'
import { toast } from 'sonner'

// ─── Types ───────────────────────────────────────────────────────────────────

type MissingRow = {
  id: string
  employee_id: string
  attendance_date: string
  status: string
  first_in: string | null
  last_out: string | null
  is_weekly_off: boolean
  is_holiday: boolean
  shifts: { code: string; name: string; start_time?: string; end_time?: string; is_night?: boolean } | null
  employees: {
    id: string
    employee_code: string
    full_name: string
    branch_id: string | null
    department_id: string | null
    branches: { id: string; name: string } | null
    departments: { id: string; name: string } | null
  } | null
}

type Branch = { id: string; name: string }
type Department = { id: string; name: string }

// ─── Helpers ─────────────────────────────────────────────────────────────────

const RANGE_OPTIONS = [
  { label: 'Yesterday', value: '1' },
  { label: 'Last 7 days', value: '7' },
  { label: 'Last 14 days', value: '14' },
  { label: 'Last 30 days', value: '30' },
]

const fmtTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', hour12: true })
    : '—'

const thClass =
  'sticky top-0 z-10 bg-muted px-3 py-3 border-b border-border text-xs uppercase text-muted-foreground font-medium text-left shadow-[0_1px_0_0_hsl(var(--border))]'

// ─── Page ─────────────────────────────────────────────────────────────────────

export function MissingBiometricsPage() {
  const { hasPermission } = useAuth()

  const [rows, setRows] = useState<MissingRow[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState('1')
  const [query, setQuery] = useState('')
  const [branchFilter, setBranchFilter] = useState('')
  const [deptFilter, setDeptFilter] = useState('')

  const { fromIso, todayIso } = useMemo(() => {
    const today = new Date()
    const from = new Date()
    from.setDate(today.getDate() - Number(range))
    return {
      fromIso: from.toISOString().slice(0, 10),
      todayIso: today.toISOString().slice(0, 10),
    }
  }, [range])

  const load = async () => {
    setLoading(true)
    try {
      const [brRes, dpRes, dailyRes, punchRes] = await Promise.all([
        supabase.from('branches').select('id, name').eq('is_active', true).order('name'),
        supabase.from('departments').select('id, name').eq('is_active', true).order('name'),
        supabase
          .from('attendance_daily')
          .select(
            `id, employee_id, attendance_date, status, first_in, last_out,
             is_weekly_off, is_holiday,
             shifts(code, name, start_time, end_time, is_night),
             employees(id, employee_code, full_name, branch_id, department_id, branches(id,name), departments(id,name))`
          )
          .gte('attendance_date', fromIso)
          .lt('attendance_date', todayIso)
          // treat NULL as false for legacy rows
          .or('is_holiday.is.null,is_holiday.eq.false')
          .or('is_weekly_off.is.null,is_weekly_off.eq.false')
          // keep rows even if status is Absent (some recomputes mark Absent when OUT is missing)
          .or('first_in.is.null,last_out.is.null')
          .order('attendance_date', { ascending: false })
          .order('employee_id'),
        supabase
          .from('attendance_punches')
          .select('employee_id, punch_at, punch_type')
          .gte('punch_at', `${fromIso}T00:00:00+05:00`)
          .lt('punch_at', `${todayIso}T00:00:00+05:00`),
      ])

      setBranches((brRes.data ?? []) as Branch[])
      setDepartments((dpRes.data ?? []) as Department[])

      const punchesByEmpDate = new Map<string, { punch_at: string; punch_type: string }[]>()
      for (const p of punchRes.data ?? []) {
        const row = p as { employee_id: string; punch_at: string; punch_type: string }
        const day = new Date(row.punch_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' })
        if (day < fromIso || day >= todayIso) continue
        const key = `${row.employee_id}:${day}`
        const list = punchesByEmpDate.get(key) ?? []
        list.push({ punch_at: row.punch_at, punch_type: row.punch_type })
        punchesByEmpDate.set(key, list)
      }

      const mapped: MissingRow[] = (dailyRes.data ?? []).map((r: Record<string, unknown>) => {
        const sh = r.shifts
        const emp = r.employees as Record<string, unknown> | null
        let empMapped: MissingRow['employees'] = null
        if (emp) {
          const br = emp.branches
          const dp = emp.departments
          empMapped = {
            id: emp.id as string,
            employee_code: emp.employee_code as string,
            full_name: emp.full_name as string,
            branch_id: emp.branch_id as string | null,
            department_id: emp.department_id as string | null,
            branches: Array.isArray(br) ? (br[0] as Branch) : (br as Branch | null),
            departments: Array.isArray(dp) ? (dp[0] as Department) : (dp as Department | null),
          }
        }
        const attendanceDate = r.attendance_date as string
        const employeeId = r.employee_id as string
        const dayPunches = punchesByEmpDate.get(`${employeeId}:${attendanceDate}`)
        const shiftRow = Array.isArray(sh) ? sh[0] : sh
        const resolved = dayPunches?.length
          ? resolveInOutFromPunches(dayPunches, {
              shift: shiftRow as MissingRow['shifts'],
            })
          : null

        return {
          ...r,
          first_in: resolved ? resolved.first_in : (r.first_in as string | null),
          last_out: resolved ? resolved.last_out : (r.last_out as string | null),
          shifts: Array.isArray(sh) ? sh[0] : sh,
          employees: empMapped,
        } as MissingRow
      })

      setRows(mapped)
    } catch (err) {
      toast.error('Failed to load missing punch records', { description: (err as Error).message })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromIso, todayIso])

  // ── Filter ─────────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((r) => {
      const e = r.employees
      // exclude non-working days + leave-like statuses
      const status = (r.status ?? '').toString()
      if (r.is_holiday || r.is_weekly_off) return false
      if (['Leave', 'Holiday', 'Weekly Off'].includes(status)) return false
      // only show when at least one side is missing
      if (r.first_in && r.last_out) return false
      if (branchFilter && e?.branch_id !== branchFilter) return false
      if (deptFilter && e?.department_id !== deptFilter) return false
      if (q) {
        const match =
          e?.full_name?.toLowerCase().includes(q) ||
          e?.employee_code?.toLowerCase().includes(q) ||
          e?.branches?.name?.toLowerCase().includes(q) ||
          e?.departments?.name?.toLowerCase().includes(q) ||
          r.attendance_date.includes(q) ||
          (r.shifts?.code ?? '').toLowerCase().includes(q)
        if (!match) return false
      }
      return true
    })
  }, [rows, query, branchFilter, deptFilter])

  const noInCount = filtered.filter((r) => !r.first_in).length
  const noOutCount = filtered.filter((r) => !r.last_out).length

  // ── Export ─────────────────────────────────────────────────────────────────
  const exportCsv = () => {
    const data = filtered.map((r) => {
      const e = r.employees
      return {
        date: r.attendance_date,
        employee_code: e?.employee_code ?? '',
        full_name: e?.full_name ?? '',
        branch: e?.branches?.name ?? '',
        department: e?.departments?.name ?? '',
        shift: r.shifts?.code ?? '',
        status: r.status,
        first_in: r.first_in ? new Date(r.first_in).toLocaleString('en-PK') : '',
        last_out: r.last_out ? new Date(r.last_out).toLocaleString('en-PK') : '',
        missing: [!r.first_in && 'No IN', !r.last_out && 'No OUT'].filter(Boolean).join(', '),
      }
    })
    downloadCsv(`missing-biometrics-${fromIso}-to-${todayIso}.csv`, toCsv(data))
    toast.success('Exported')
  }

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <PageHeader
        title="Missing biometrics"
        description="Employees with a missing IN or OUT punch on working days. Excludes absent, holidays, and weekly-offs."
        actions={
          <>
            <Select className="w-36" value={range} onChange={(e) => setRange(e.target.value)}>
              {RANGE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </Select>
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            </Button>
            {hasPermission('attendance.export') && (
              <Button variant="outline" size="sm" onClick={exportCsv} disabled={filtered.length === 0}>
                Export CSV
              </Button>
            )}
          </>
        }
      />

      {/* Summary counts */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total records', value: filtered.length },
          { label: 'No IN punch', value: noInCount },
          { label: 'No OUT punch', value: noOutCount },
          { label: 'Both missing', value: filtered.filter((r) => !r.first_in && !r.last_out).length },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground uppercase tracking-wider">{s.label}</div>
              <div className="text-2xl font-semibold tabular-nums">{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search employee or date…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <Select className="w-44" value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
              <option value="">All branches</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
            <Select className="w-44" value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
              <option value="">All departments</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-16 grid place-items-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-6 py-12 text-sm text-muted-foreground">
              No missing punch records found for the selected period.
            </div>
          ) : (
            <div className="overflow-auto border-t">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr>
                    <th className={cn(thClass, 'px-6')}>Employee</th>
                    <th className={thClass}>Date</th>
                    <th className={thClass}>Shift</th>
                    <th className={thClass}>Status</th>
                    <th className={thClass}>IN</th>
                    <th className={thClass}>OUT</th>
                    <th className={thClass}>Missing</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map((r, i) => {
                    const e = r.employees
                    return (
                      <tr key={`${r.id}-${i}`} className="hover:bg-muted/20">
                        {/* Employee */}
                        <td className="px-6 py-3">
                          <div className="flex items-center gap-3">
                            <Avatar className="h-8 w-8">
                              <AvatarFallback className={avatarColorFor(e?.employee_code ?? '')}>
                                {initialsFromName(e?.full_name ?? '?')}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <div className="font-medium">{e?.full_name ?? '—'}</div>
                              <div className="text-xs text-muted-foreground">{e?.employee_code ?? ''}</div>
                            </div>
                          </div>
                        </td>
                        {/* Date */}
                        <td className="px-3 py-3 font-mono text-xs whitespace-nowrap">{r.attendance_date}</td>
                        {/* Shift */}
                        <td className="px-3 py-3 text-xs">
                          {r.shifts?.code ? (
                            <span className="text-muted-foreground" title={r.shifts.name}>{r.shifts.code}</span>
                          ) : (
                            <span className="text-muted-foreground/60 italic">No shift</span>
                          )}
                        </td>
                        {/* Status */}
                        <td className="px-3 py-3">
                          <Badge variant={r.status === 'Present' ? 'warm' : r.status === 'Late' || r.status === 'Half Day' ? 'warm' : 'outline'}>
                            {r.status}
                          </Badge>
                        </td>
                        {/* IN */}
                        <td className="px-3 py-3 tabular-nums">
                          {r.first_in ? (
                            fmtTime(r.first_in)
                          ) : (
                            <span className="text-amber-600 dark:text-amber-400 font-medium">—</span>
                          )}
                        </td>
                        {/* OUT */}
                        <td className="px-3 py-3 tabular-nums">
                          {r.last_out ? (
                            fmtTime(r.last_out)
                          ) : (
                            <span className="text-rose-600 dark:text-rose-400 font-medium">—</span>
                          )}
                        </td>
                        {/* Missing badges */}
                        <td className="px-3 py-3">
                          <div className="flex flex-wrap gap-1">
                            {!r.first_in && (
                              <Badge variant="outline" className="text-xs text-amber-700 border-amber-300 dark:text-amber-300">
                                No IN
                              </Badge>
                            )}
                            {!r.last_out && (
                              <Badge variant="outline" className="text-xs text-rose-700 border-rose-300 dark:text-rose-300">
                                No OUT
                              </Badge>
                            )}
                          </div>
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
    </div>
  )
}
