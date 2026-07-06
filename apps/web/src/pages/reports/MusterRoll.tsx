import { useEffect, useMemo, useState } from 'react'
import { Download, Loader2, Printer, RefreshCw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { PageHeader } from '@/components/master/PageHeader'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import { toast } from 'sonner'
import { downloadCsv } from '@/lib/csv'
import { FilterBar, ReportBackLink, monthOptions, printableStyles } from './shared'
import { getLiveDisplayStatus } from '@/lib/liveAttendance'

type Employee = {
  id: string
  employee_code: string
  full_name: string
  branches: { name: string } | null
  departments: { name: string } | null
}

type Daily = {
  employee_id: string
  attendance_date: string
  status: string | null
  first_in: string | null
  last_out: string | null
  is_weekly_off: boolean | null
  is_holiday: boolean | null
  worked_minutes: number | null
  late_minutes: number | null
  overtime_minutes: number | null
}

const DOW_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const

const codeFor = (d: Daily | undefined): { code: string; cls: string; title: string } => {
  if (!d) return { code: '·', cls: 'text-slate-300', title: 'No record' }
  
  const displayStatus = getLiveDisplayStatus(d)
  
  switch (displayStatus) {
    case 'Holiday':
      return { code: 'H', cls: 'bg-orange-100 text-orange-700', title: 'Holiday' }
    case 'Weekly Off':
      return { code: 'W', cls: 'bg-slate-200 text-slate-700', title: 'Weekly off' }
    case 'Present':
      return { code: 'P', cls: 'bg-green-100 text-green-700', title: 'Present' }
    case 'Leave':
      return { code: 'L', cls: 'bg-blue-100 text-blue-700', title: 'Leave' }
    case 'Absent':
      return { code: 'A', cls: 'bg-red-100 text-red-700', title: 'Absent' }
    case 'Late':
      return { code: 'LT', cls: 'bg-yellow-100 text-yellow-800', title: 'Late' }
    case 'Half Day':
      return { code: 'HD', cls: 'bg-amber-100 text-amber-800', title: 'Half day' }
    default:
      return { code: '·', cls: 'text-slate-300', title: 'No record' }
  }
}

export function MusterRollPage() {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [employees, setEmployees] = useState<Employee[]>([])
  const [daily, setDaily] = useState<Daily[]>([])
  const [loading, setLoading] = useState(true)
  const [branchFilter, setBranchFilter] = useState('')
  const [deptFilter, setDeptFilter] = useState('')
  const [employeeFilter, setEmployeeFilter] = useState('')

  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const days = useMemo(() => Array.from({ length: daysInMonth }, (_, i) => i + 1), [daysInMonth])

  async function load() {
    setLoading(true)
    const first = `${year}-${String(month + 1).padStart(2, '0')}-01`
    const last = `${year}-${String(month + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`
    const [{ data: emps, error: ee }, { data: ad, error: ae }] = await Promise.all([
      supabase
        .from('employees')
        .select('id, employee_code, full_name, branches(name), departments(name)')
        .eq('is_active', true)
        .order('full_name'),
      supabase
        .from('attendance_daily')
        .select('employee_id, attendance_date, status, first_in, last_out, is_weekly_off, is_holiday, worked_minutes, late_minutes, overtime_minutes')
        .gte('attendance_date', first)
        .lte('attendance_date', last),
    ])
    if (ee || ae) toast.error('Failed to load', { description: ee?.message || ae?.message })
    setEmployees(
      ((emps ?? []) as unknown as Record<string, unknown>[]).map((r) => {
        const pick = (k: string) => {
          const v = r[k]
          return Array.isArray(v) ? (v[0] as object | null) : (v as object | null)
        }
        return { ...(r as object), branches: pick('branches'), departments: pick('departments') } as Employee
      })
    )
    setDaily((ad ?? []) as Daily[])
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [year, month])

  const dailyMap = useMemo(() => {
    const m = new Map<string, Daily>()
    daily.forEach((d) => m.set(`${d.employee_id}|${d.attendance_date}`, d))
    return m
  }, [daily])

  const branches = useMemo(() => Array.from(new Set(employees.map((e) => e.branches?.name).filter(Boolean) as string[])).sort(), [employees])
  const departments = useMemo(() => Array.from(new Set(employees.map((e) => e.departments?.name).filter(Boolean) as string[])).sort(), [employees])

  const employeesForPicker = useMemo(
    () =>
      employees
        .filter(
          (e) =>
            (!branchFilter || e.branches?.name === branchFilter) &&
            (!deptFilter || e.departments?.name === deptFilter)
        )
        .sort((a, b) => a.full_name.localeCompare(b.full_name)),
    [employees, branchFilter, deptFilter]
  )

  useEffect(() => {
    if (employeeFilter && !employeesForPicker.some((e) => e.id === employeeFilter)) {
      setEmployeeFilter('')
    }
  }, [employeesForPicker, employeeFilter])

  const filteredEmps = useMemo(
    () =>
      employeesForPicker.filter((e) => !employeeFilter || e.id === employeeFilter),
    [employeesForPicker, employeeFilter]
  )

  const rowTotals = (empId: string) => {
    let p = 0, a = 0, l = 0, h = 0, w = 0, ot = 0, late = 0
    for (const d of days) {
      const k = `${empId}|${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      const r = dailyMap.get(k)
      const c = codeFor(r).code
      if (c === 'P' || c === 'LT' || c === 'HD') p += 1
      else if (c === 'A') a += 1
      else if (c === 'L') l += 1
      else if (c === 'H') h += 1
      else if (c === 'W') w += 1
      if (r) {
        ot += Number(r.overtime_minutes ?? 0)
        late += Number(r.late_minutes ?? 0)
      }
    }
    return { p, a, l, h, w, ot: Math.round(ot / 60 * 100) / 100, late }
  }

  function exportCsv() {
    const monthLabel = monthOptions[month].l
    const headers = ['Code', 'Name', 'Branch', 'Department', ...days.map(String), 'P', 'A', 'L', 'H', 'W', 'OT (hrs)', 'Late (min)']
    const lines = [headers.join(',')]
    filteredEmps.forEach((e) => {
      const totals = rowTotals(e.id)
      const cells = days.map((d) => {
        const k = `${e.id}|${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
        return codeFor(dailyMap.get(k)).code
      })
      const row = [
        e.employee_code,
        `"${e.full_name.replace(/"/g, '""')}"`,
        `"${(e.branches?.name ?? '').replace(/"/g, '""')}"`,
        `"${(e.departments?.name ?? '').replace(/"/g, '""')}"`,
        ...cells,
        totals.p,
        totals.a,
        totals.l,
        totals.h,
        totals.w,
        totals.ot,
        totals.late,
      ]
      lines.push(row.join(','))
    })
    downloadCsv(`monthly-attendance-${monthLabel}-${year}.csv`, lines.join('\r\n'))
  }

  return (
    <div className="space-y-4">
      <ReportBackLink />
      <PageHeader
        title="Monthly attendance"
        description="Day-by-day attendance status for the selected month. Filter by branch, department, or one employee."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="h-4 w-4" /> Print
            </Button>
            <Button size="sm" onClick={exportCsv} disabled={filteredEmps.length === 0}>
              <Download className="h-4 w-4" /> CSV
            </Button>
          </>
        }
      />

      <FilterBar>
        <div className="min-w-[140px]">
          <Label className="text-xs">Year</Label>
          <Select value={year} onChange={(e) => setYear(parseInt(e.target.value, 10))}>
            {Array.from({ length: 6 }, (_, i) => today.getFullYear() - 3 + i).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </div>
        <div className="min-w-[140px]">
          <Label className="text-xs">Month</Label>
          <Select value={month} onChange={(e) => setMonth(parseInt(e.target.value, 10))}>
            {monthOptions.map((m) => (
              <option key={m.v} value={m.v}>
                {m.l}
              </option>
            ))}
          </Select>
        </div>
        <div className="min-w-[160px]">
          <Label className="text-xs">Branch</Label>
          <Select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </Select>
        </div>
        <div className="min-w-[160px]">
          <Label className="text-xs">Department</Label>
          <Select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
        </div>
        <div className="min-w-[220px]">
          <Label className="text-xs">Employee</Label>
          <Select value={employeeFilter} onChange={(e) => setEmployeeFilter(e.target.value)}>
            <option value="">All employees</option>
            {employeesForPicker.map((e) => (
              <option key={e.id} value={e.id}>
                {e.employee_code} — {e.full_name}
              </option>
            ))}
          </Select>
        </div>
        <div className="ml-auto text-xs text-muted-foreground">
          Legend: <span className="font-mono">P</span> Present · <span className="font-mono">A</span> Absent ·{' '}
          <span className="font-mono">L</span> Leave · <span className="font-mono">H</span> Holiday ·{' '}
          <span className="font-mono">W</span> Weekly off
        </div>
      </FilterBar>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {loading ? (
            <div className="p-12 grid place-items-center">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <table className="w-full text-xs report-table muster-roll-table border-collapse">
              <thead>
                <tr className="muster-roll-header">
                  <th className="muster-roll-th muster-roll-th-sticky text-left pl-2 pr-3 min-w-[88px] sticky left-0 z-20">
                    Employee Code
                  </th>
                  <th className="muster-roll-th muster-roll-th-sticky text-left pl-2 pr-3 min-w-[140px] sticky left-[88px] z-20">
                    Name
                  </th>
                  {days.map((d) => {
                    const dow = new Date(year, month, d).getDay()
                    return (
                      <th key={d} className="muster-roll-th muster-roll-th-day">
                        <span className="block text-[11px] font-semibold leading-tight tabular-nums">
                          {String(d).padStart(2, '0')}
                        </span>
                        <span className="block text-[10px] font-medium leading-tight text-slate-600">
                          {DOW_LETTERS[dow]}
                        </span>
                      </th>
                    )
                  })}
                  <th className="muster-roll-th muster-roll-th-total">P</th>
                  <th className="muster-roll-th muster-roll-th-total">A</th>
                  <th className="muster-roll-th muster-roll-th-total">L</th>
                  <th className="muster-roll-th muster-roll-th-total">H</th>
                  <th className="muster-roll-th muster-roll-th-total">W</th>
                  <th className="muster-roll-th muster-roll-th-total border-r-0">OT</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredEmps.map((e) => {
                  const totals = rowTotals(e.id)
                  return (
                    <tr key={e.id} className="hover:bg-muted/30">
                      <td className="px-2 py-1.5 font-mono sticky left-0 bg-card z-[1] border-r border-[#9ec5de]/50">
                        {e.employee_code}
                      </td>
                      <td className="px-2 py-1.5 sticky left-[88px] bg-card z-[1] whitespace-nowrap border-r border-[#9ec5de]/50">
                        {e.full_name}
                      </td>
                      {days.map((d) => {
                        const k = `${e.id}|${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
                        const c = codeFor(dailyMap.get(k))
                        return (
                          <td
                            key={d}
                            className="px-0.5 py-1.5 text-center border-r border-[#9ec5de]/40"
                            title={c.title}
                          >
                            <span className={`inline-block min-w-[18px] text-[10px] font-semibold px-1 rounded ${c.cls}`}>
                              {c.code}
                            </span>
                          </td>
                        )
                      })}
                      <td className="px-2 py-1.5 text-center font-semibold tabular-nums">{totals.p}</td>
                      <td className="px-2 py-1.5 text-center font-semibold tabular-nums">{totals.a}</td>
                      <td className="px-2 py-1.5 text-center font-semibold tabular-nums">{totals.l}</td>
                      <td className="px-2 py-1.5 text-center font-semibold tabular-nums">{totals.h}</td>
                      <td className="px-2 py-1.5 text-center font-semibold tabular-nums">{totals.w}</td>
                      <td className="px-2 py-1.5 text-center font-semibold tabular-nums">{totals.ot}</td>
                    </tr>
                  )
                })}
                {filteredEmps.length === 0 && (
                  <tr>
                    <td colSpan={days.length + 8} className="px-4 py-12 text-center text-muted-foreground">
                      No employees match the current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <style>{`
        ${printableStyles}
        .muster-roll-table .muster-roll-header th {
          background-color: #e4e4e4;
          background-image: repeating-linear-gradient(
            -45deg,
            transparent,
            transparent 3px,
            rgba(255, 255, 255, 0.55) 3px,
            rgba(255, 255, 255, 0.55) 6px
          );
          border-right: 1px solid #9ec5de;
          color: #1e293b;
          font-weight: 600;
          vertical-align: middle;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .muster-roll-table .muster-roll-th-day {
          min-width: 26px;
          width: 26px;
          padding: 4px 2px;
          text-align: center;
        }
        .muster-roll-table .muster-roll-th-total {
          min-width: 32px;
          padding: 6px 4px;
          text-align: center;
        }
        .muster-roll-table .muster-roll-th-sticky {
          box-shadow: 2px 0 4px rgba(0, 0, 0, 0.06);
        }
        .dark .muster-roll-table .muster-roll-header th {
          background-color: #3f3f46;
          background-image: repeating-linear-gradient(
            -45deg,
            transparent,
            transparent 3px,
            rgba(255, 255, 255, 0.08) 3px,
            rgba(255, 255, 255, 0.08) 6px
          );
          border-right-color: #475569;
          color: #f1f5f9;
        }
        .dark .muster-roll-table .muster-roll-th-day span:last-child {
          color: #cbd5e1;
        }
        @media print {
          .muster-roll-table .muster-roll-header th {
            background-color: #e4e4e4 !important;
            background-image: repeating-linear-gradient(
              -45deg,
              transparent,
              transparent 3px,
              rgba(255, 255, 255, 0.55) 3px,
              rgba(255, 255, 255, 0.55) 6px
            ) !important;
            border-right: 1px solid #9ec5de !important;
          }
        }
      `}</style>
    </div>
  )
}
