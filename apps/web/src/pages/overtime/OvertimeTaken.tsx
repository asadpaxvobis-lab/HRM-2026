import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, RefreshCw, Search, Timer } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { PageHeader } from '@/components/master/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

type EmployeeRow = {
  id: string
  employee_code: string
  full_name: string
  departments: { name: string } | null
  attendanceOtMinutes: number
  requestHours: number
  requestCount: number
  pendingCount: number
}

function monthStartIso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function fmtHours(minutes: number) {
  if (minutes <= 0) return '0h'
  const h = Math.round((minutes / 60) * 100) / 100
  return `${h}h`
}

export function OvertimeTakenPage() {
  const today = useMemo(() => new Date(), [])
  const [period, setPeriod] = useState<'month' | 'today'>('month')
  const [rows, setRows] = useState<EmployeeRow[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')

  const range = useMemo(() => {
    const end = today.toISOString().slice(0, 10)
    const start = period === 'today' ? end : monthStartIso(today)
    return { start, end }
  }, [period, today])

  async function load() {
    setLoading(true)
    const [{ data: emps }, { data: daily }, { data: otReqs }] = await Promise.all([
      supabase
        .from('employees')
        .select('id, employee_code, full_name, departments(name)')
        .eq('is_active', true)
        .order('full_name'),
      supabase
        .from('attendance_daily')
        .select('employee_id, overtime_minutes')
        .gte('attendance_date', range.start)
        .lte('attendance_date', range.end)
        .gt('overtime_minutes', 0),
      supabase
        .from('overtime_requests')
        .select('employee_id, planned_hours, actual_hours, status')
        .gte('ot_date', range.start)
        .lte('ot_date', range.end)
        .in('status', ['PENDING', 'APPROVED', 'PAID']),
    ])

    const attByEmp = new Map<string, number>()
    for (const d of daily ?? []) {
      const id = d.employee_id as string
      attByEmp.set(id, (attByEmp.get(id) ?? 0) + Number(d.overtime_minutes ?? 0))
    }

    const reqByEmp = new Map<string, { hours: number; count: number; pending: number }>()
    for (const r of otReqs ?? []) {
      const id = r.employee_id as string
      const hrs = Number(r.actual_hours ?? r.planned_hours ?? 0)
      const cur = reqByEmp.get(id) ?? { hours: 0, count: 0, pending: 0 }
      cur.hours += hrs
      cur.count += 1
      if (r.status === 'PENDING') cur.pending += 1
      reqByEmp.set(id, cur)
    }

    const merged: EmployeeRow[] = []
    for (const raw of emps ?? []) {
      const r = raw as Record<string, unknown>
      const dep = r.departments
      const id = r.id as string
      const attendanceOtMinutes = attByEmp.get(id) ?? 0
      const req = reqByEmp.get(id)
      const requestHours = req?.hours ?? 0
      if (attendanceOtMinutes <= 0 && requestHours <= 0) continue

      merged.push({
        id,
        employee_code: r.employee_code as string,
        full_name: r.full_name as string,
        departments: Array.isArray(dep) ? (dep[0] as { name: string }) : (dep as { name: string } | null),
        attendanceOtMinutes,
        requestHours,
        requestCount: req?.count ?? 0,
        pendingCount: req?.pending ?? 0,
      })
    }

    merged.sort((a, b) => {
      const ta = a.attendanceOtMinutes + a.requestHours * 60
      const tb = b.attendanceOtMinutes + b.requestHours * 60
      return tb - ta
    })

    setRows(merged)
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [period])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (e) =>
        e.full_name.toLowerCase().includes(q) ||
        e.employee_code.toLowerCase().includes(q) ||
        (e.departments?.name ?? '').toLowerCase().includes(q)
    )
  }, [rows, query])

  const totals = useMemo(() => {
    let attMin = 0
    let reqH = 0
    for (const r of filtered) {
      attMin += r.attendanceOtMinutes
      reqH += r.requestHours
    }
    return { employees: filtered.length, attMin, reqH }
  }, [filtered])

  return (
    <div className="space-y-4">
      <PageHeader
        title="Overtime taken"
        description="Employees who worked overtime or have overtime requests in the selected period."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/overtime">All OT requests →</Link>
            </Button>
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[140px]">
          <Label className="text-xs">Period</Label>
          <Select value={period} onChange={(e) => setPeriod(e.target.value as 'month' | 'today')}>
            <option value="month">This month</option>
            <option value="today">Today only</option>
          </Select>
        </div>
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search employee"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="text-sm text-muted-foreground flex items-center gap-2 ml-auto">
          <Timer className="h-4 w-4" />
          <span>
            {totals.employees} employee(s) · {fmtHours(totals.attMin)} from attendance ·{' '}
            {totals.reqH.toFixed(1)}h from requests
          </span>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="py-16 grid place-items-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              No overtime recorded for this period.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr className="text-left">
                    <th className="px-4 py-3">Employee</th>
                    <th className="px-3 py-3">Department</th>
                    <th className="px-3 py-3 text-right">Attendance OT</th>
                    <th className="px-3 py-3 text-right">Request hours</th>
                    <th className="px-3 py-3 text-right">Requests</th>
                    <th className="px-3 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map((e) => (
                    <tr key={e.id} className="hover:bg-muted/20">
                      <td className="px-4 py-3">
                        <Link to={`/employees/${e.id}`} className="font-medium text-primary hover:underline">
                          {e.full_name}
                        </Link>
                        <div className="text-xs text-muted-foreground font-mono">{e.employee_code}</div>
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">{e.departments?.name ?? '—'}</td>
                      <td className="px-3 py-3 text-right tabular-nums font-medium">
                        {fmtHours(e.attendanceOtMinutes)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{e.requestHours.toFixed(1)}h</td>
                      <td className="px-3 py-3 text-right tabular-nums">{e.requestCount}</td>
                      <td className="px-3 py-3">
                        {e.pendingCount > 0 ? (
                          <Badge variant="warm">{e.pendingCount} pending</Badge>
                        ) : (
                          <Badge variant="outline">Recorded</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
