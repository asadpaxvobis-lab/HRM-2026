import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlarmClock, Loader2, RefreshCw, Search } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { PageHeader } from '@/components/master/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

type DailyLate = {
  attendance_date: string
  status: string | null
  first_in: string | null
  late_minutes: number
}

type EmployeeRow = {
  id: string
  employee_code: string
  full_name: string
  departments: { name: string } | null
  lateDays: number
  totalLateMinutes: number
  days: DailyLate[]
}

type DayChartPoint = {
  date: string
  label: string
  minutes: number
  employees: number
}

function monthStartIso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function eachDayInRange(start: string, end: string): string[] {
  const [sy, sm, sd] = start.split('-').map(Number)
  const [ey, em, ed] = end.split('-').map(Number)
  const cur = new Date(sy, sm - 1, sd)
  const last = new Date(ey, em - 1, ed)
  const days: string[] = []
  while (cur <= last) {
    days.push(
      `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`
    )
    cur.setDate(cur.getDate() + 1)
  }
  return days
}

function isLateRecord(row: { status?: string | null; late_minutes?: number | null }) {
  const mins = Number(row.late_minutes ?? 0)
  const status = (row.status ?? '').trim()
  return mins > 0 || status === 'Late' || status.toLowerCase().includes('late')
}

const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', hour12: true }) : '—'

export function LateEmployeesPage() {
  const today = useMemo(() => new Date(), [])
  const [period, setPeriod] = useState<'month' | 'today'>('month')
  const [rows, setRows] = useState<EmployeeRow[]>([])
  const [chartByDay, setChartByDay] = useState<DayChartPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')

  const range = useMemo(() => {
    const end = today.toISOString().slice(0, 10)
    const start = period === 'today' ? end : monthStartIso(today)
    return { start, end }
  }, [period, today])

  async function load() {
    setLoading(true)
    const [{ data: emps }, { data: daily }] = await Promise.all([
      supabase
        .from('employees')
        .select('id, employee_code, full_name, departments(name)')
        .eq('is_active', true)
        .order('full_name'),
      supabase
        .from('attendance_daily')
        .select('employee_id, attendance_date, status, first_in, late_minutes')
        .gte('attendance_date', range.start)
        .lte('attendance_date', range.end)
        .order('attendance_date', { ascending: false }),
    ])

    const empMap = new Map<string, EmployeeRow>()
    for (const raw of emps ?? []) {
      const r = raw as Record<string, unknown>
      const dep = r.departments
      empMap.set(r.id as string, {
        id: r.id as string,
        employee_code: r.employee_code as string,
        full_name: r.full_name as string,
        departments: Array.isArray(dep) ? (dep[0] as { name: string }) : (dep as { name: string } | null),
        lateDays: 0,
        totalLateMinutes: 0,
        days: [],
      })
    }

    for (const d of daily ?? []) {
      if (!isLateRecord(d)) continue
      const id = d.employee_id as string
      const emp = empMap.get(id)
      if (!emp) continue
      const mins = Math.max(Number(d.late_minutes ?? 0), 1)
      emp.days.push({
        attendance_date: d.attendance_date as string,
        status: d.status as string | null,
        first_in: d.first_in as string | null,
        late_minutes: mins,
      })
      emp.lateDays += 1
      emp.totalLateMinutes += Number(d.late_minutes ?? 0) || mins
    }

    const merged = [...empMap.values()]
      .filter((e) => e.lateDays > 0)
      .sort((a, b) => b.totalLateMinutes - a.totalLateMinutes)

    const dayAgg = new Map<string, { minutes: number; employees: Set<string> }>()
    for (const d of daily ?? []) {
      if (!isLateRecord(d)) continue
      const date = d.attendance_date as string
      const cur = dayAgg.get(date) ?? { minutes: 0, employees: new Set<string>() }
      cur.minutes += Number(d.late_minutes ?? 0) || 1
      cur.employees.add(d.employee_id as string)
      dayAgg.set(date, cur)
    }

    const chartPoints: DayChartPoint[] = eachDayInRange(range.start, range.end).map((iso) => {
      const agg = dayAgg.get(iso)
      const dayNum = iso.slice(8, 10)
      return {
        date: iso,
        label: dayNum,
        minutes: agg?.minutes ?? 0,
        employees: agg?.employees.size ?? 0,
      }
    })

    setRows(merged)
    setChartByDay(chartPoints)
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
    let employees = filtered.length
    let days = 0
    let minutes = 0
    for (const r of filtered) {
      days += r.lateDays
      minutes += r.totalLateMinutes
    }
    return { employees, days, minutes }
  }, [filtered])

  const maxDayMinutes = useMemo(() => Math.max(1, ...chartByDay.map((p) => p.minutes)), [chartByDay])
  const maxEmpMinutes = useMemo(
    () => Math.max(1, ...filtered.map((e) => e.totalLateMinutes)),
    [filtered]
  )

  const monthLabel = useMemo(
    () => today.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    [today]
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title="Late employees"
        description="Employees who arrived late — from daily attendance (after grace period)."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/attendance">Daily attendance →</Link>
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
          <AlarmClock className="h-4 w-4" />
          <span>
            {totals.employees} employee(s) · {totals.days} late day(s) · {totals.minutes} min total
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
            <div className="py-16 text-center text-sm text-muted-foreground">No late arrivals in this period.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr className="text-left">
                    <th className="px-4 py-3">Employee</th>
                    <th className="px-3 py-3">Department</th>
                    <th className="px-3 py-3 text-right">Late days</th>
                    <th className="px-3 py-3 text-right">Total late (min)</th>
                    <th className="px-3 py-3">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map((e) => (
                    <tr key={e.id} className="hover:bg-muted/20 align-top">
                      <td className="px-4 py-3">
                        <Link to={`/employees/${e.id}`} className="font-medium text-primary hover:underline">
                          {e.full_name}
                        </Link>
                        <div className="text-xs text-muted-foreground font-mono">{e.employee_code}</div>
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">{e.departments?.name ?? '—'}</td>
                      <td className="px-3 py-3 text-right tabular-nums font-medium">{e.lateDays}</td>
                      <td className="px-3 py-3 text-right tabular-nums font-medium text-amber-700 dark:text-amber-400">
                        {e.totalLateMinutes}
                      </td>
                      <td className="px-3 py-3">
                        <ul className="space-y-1 text-xs">
                          {e.days.slice(0, period === 'today' ? 5 : 8).map((d) => (
                            <li key={d.attendance_date} className="flex flex-wrap items-center gap-2">
                              <span className="text-muted-foreground">{d.attendance_date}</span>
                              <Badge variant="outline" className="text-amber-700 border-amber-300">
                                {d.late_minutes} min late
                              </Badge>
                              <span className="text-muted-foreground">In {fmtTime(d.first_in)}</span>
                            </li>
                          ))}
                          {e.days.length > 8 && period === 'month' && (
                            <li className="text-muted-foreground">+{e.days.length - 8} more day(s)</li>
                          )}
                        </ul>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {!loading && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {period === 'month' ? `Monthly late — ${monthLabel}` : 'Late today'}
              </CardTitle>
              <CardDescription>Total late minutes per day (bar height).</CardDescription>
            </CardHeader>
            <CardContent>
              {chartByDay.every((p) => p.minutes === 0) ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No late data for this period.</p>
              ) : (
                <div className="overflow-x-auto pb-1">
                  <div className="flex items-end gap-1 min-h-[200px] h-[200px] border-b border-muted px-1">
                    {chartByDay.map((p) => {
                      const h = p.minutes > 0 ? Math.max(6, (p.minutes / maxDayMinutes) * 100) : 0
                      return (
                        <div
                          key={p.date}
                          className="flex flex-col items-center justify-end gap-1 flex-1 min-w-[22px] max-w-[36px] h-full group"
                          title={`${p.date}: ${p.minutes} min late · ${p.employees} employee(s)`}
                        >
                          {p.minutes > 0 && (
                            <span className="text-[9px] font-medium text-amber-700 dark:text-amber-400 tabular-nums opacity-0 group-hover:opacity-100">
                              {p.minutes}
                            </span>
                          )}
                          <div
                            className={cn(
                              'w-full rounded-t transition-all',
                              p.minutes > 0 ? 'bg-amber-500 hover:bg-amber-600' : 'bg-muted/40'
                            )}
                            style={{ height: `${h}%` }}
                          />
                          <span className="text-[10px] text-muted-foreground tabular-nums pt-1">{p.label}</span>
                        </div>
                      )
                    })}
                  </div>
                  <div className="flex justify-between text-[10px] text-muted-foreground mt-2 px-1">
                    <span>Day of month</span>
                    <span>Max {maxDayMinutes} min</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Late by employee</CardTitle>
              <CardDescription>Total late minutes in selected period (filtered list).</CardDescription>
            </CardHeader>
            <CardContent>
              {filtered.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No employees to chart.</p>
              ) : (
                <ul className="space-y-3">
                  {filtered.slice(0, 12).map((e) => {
                    const pct = (e.totalLateMinutes / maxEmpMinutes) * 100
                    return (
                      <li key={e.id}>
                        <div className="flex justify-between text-xs mb-1 gap-2">
                          <span className="font-medium truncate">{e.full_name}</span>
                          <span className="text-amber-700 dark:text-amber-400 tabular-nums shrink-0">
                            {e.totalLateMinutes} min
                          </span>
                        </div>
                        <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-amber-500"
                            style={{ width: `${Math.max(pct, e.totalLateMinutes > 0 ? 4 : 0)}%` }}
                          />
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {e.lateDays} late day(s) · {e.employee_code}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
