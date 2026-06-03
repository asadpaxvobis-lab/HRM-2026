import { Fragment, useEffect, useMemo, useState } from 'react'
import { Download, Loader2, Printer, RefreshCw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { PageHeader } from '@/components/master/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { toast } from 'sonner'
import { downloadCsv, toCsv } from '@/lib/csv'
import { formatPkr } from '@/lib/overtimePay'
import { FilterBar, ReportBackLink, fmtMoney, fmtNum, printableStyles } from './shared'

type GroupMode = 'date' | 'employee'

type OtRow = {
  id: string
  ot_no: string
  ot_date: string
  start_time: string | null
  end_time: string | null
  planned_hours: number
  actual_hours: number | null
  ot_type: string
  rate_multiplier: number
  amount: number | null
  status: string
  source: string | null
  employees?: {
    employee_code: string
    full_name: string
    departments: { name: string } | null
    designations: { title: string } | null
  }
  approver?: { full_name: string | null; email: string } | null
  approved_by_user?: { full_name: string | null; email: string } | null
}

function monthStartEnd(): { from: string; to: string } {
  const d = new Date()
  const y = d.getFullYear()
  const m = d.getMonth()
  const from = `${y}-${String(m + 1).padStart(2, '0')}-01`
  const last = new Date(y, m + 1, 0).getDate()
  const to = `${y}-${String(m + 1).padStart(2, '0')}-${String(last).padStart(2, '0')}`
  return { from, to }
}

function fmtReportDate(iso: string): string {
  const [y, mo, d] = iso.slice(0, 10).split('-')
  return `${d}-${mo}-${y.slice(2)}`
}

function fmtTime(t: string | null): string {
  if (!t) return '—'
  const parts = t.split(':')
  if (parts.length < 2) return t
  return `${parts[0]}:${parts[1]}:${parts[2] ?? '00'}`
}

function flattenEmp(r: Record<string, unknown>): OtRow['employees'] {
  const e = r.employees
  const emp = Array.isArray(e) ? (e as unknown[])[0] : e
  if (!emp || typeof emp !== 'object') return undefined
  const row = emp as Record<string, unknown>
  const d = row.departments
  const des = row.designations
  return {
    employee_code: String(row.employee_code ?? ''),
    full_name: String(row.full_name ?? ''),
    departments: Array.isArray(d) ? (d[0] as { name: string }) : (d as { name: string } | null),
    designations: Array.isArray(des) ? (des[0] as { title: string }) : (des as { title: string } | null),
  }
}

function flattenUser(r: Record<string, unknown>, key: string) {
  const u = r[key]
  const user = Array.isArray(u) ? (u as unknown[])[0] : u
  return user as { full_name: string | null; email: string } | null
}

function approvalBy(r: OtRow): string {
  if (r.status === 'APPROVED' || r.status === 'PAID') {
    return r.approved_by_user?.full_name ?? r.approved_by_user?.email ?? '—'
  }
  if (r.approver?.full_name || r.approver?.email) {
    return r.approver.full_name ?? r.approver.email ?? '—'
  }
  return '—'
}

function hoursOf(r: OtRow): number {
  return Number(r.actual_hours ?? r.planned_hours ?? 0)
}

export function OvertimeReportPage() {
  const { from: defaultFrom, to: defaultTo } = monthStartEnd()
  const [from, setFrom] = useState(defaultFrom)
  const [to, setTo] = useState(defaultTo)
  const [statusFilter, setStatusFilter] = useState<'active' | 'all'>('active')
  const [deptFilter, setDeptFilter] = useState('')
  const [groupMode, setGroupMode] = useState<GroupMode>('date')
  const [rows, setRows] = useState<OtRow[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    if (!from || !to) return
    setLoading(true)
    let q = supabase
      .from('overtime_requests')
      .select(
        `id, ot_no, ot_date, start_time, end_time, planned_hours, actual_hours, ot_type, rate_multiplier, amount, status, source,
        employees(employee_code, full_name, departments(name), designations(title)),
        approver:users!overtime_requests_approver_id_fkey(full_name, email),
        approved_by_user:users!overtime_requests_approved_by_fkey(full_name, email)`
      )
      .gte('ot_date', from)
      .lte('ot_date', to)
      .order('ot_date', { ascending: false })

    if (statusFilter === 'active') {
      q = q.in('status', ['PENDING', 'APPROVED', 'PAID'])
    }

    const { data, error } = await q
    if (error) {
      toast.error('Failed to load overtime report', { description: error.message })
      setRows([])
    } else {
      setRows(
        ((data ?? []) as Record<string, unknown>[]).map((r) => ({
          ...(r as object),
          employees: flattenEmp(r),
          approver: flattenUser(r, 'approver'),
          approved_by_user: flattenUser(r, 'approved_by_user'),
        })) as OtRow[]
      )
    }
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [from, to, statusFilter])

  const departments = useMemo(
    () =>
      Array.from(new Set(rows.map((r) => r.employees?.departments?.name).filter(Boolean) as string[])).sort(),
    [rows]
  )

  const filtered = useMemo(
    () => rows.filter((r) => !deptFilter || r.employees?.departments?.name === deptFilter),
    [rows, deptFilter]
  )

  const sortedByDate = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const dc = b.ot_date.localeCompare(a.ot_date)
      if (dc !== 0) return dc
      const na = a.employees?.full_name ?? ''
      const nb = b.employees?.full_name ?? ''
      return na.localeCompare(nb)
    })
  }, [filtered])

  const employeeGroups = useMemo(() => {
    const map = new Map<string, OtRow[]>()
    for (const r of filtered) {
      const key = r.employees?.employee_code ?? r.id
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(r)
    }
    return Array.from(map.entries())
      .map(([code, list]) => ({
        code,
        name: list[0]?.employees?.full_name ?? '',
        dept: list[0]?.employees?.departments?.name ?? '',
        designation: list[0]?.employees?.designations?.title ?? '',
        rows: [...list].sort((a, b) => b.ot_date.localeCompare(a.ot_date)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [filtered])

  const totals = useMemo(() => {
    const hours = filtered.reduce((s, r) => s + hoursOf(r), 0)
    const amount = filtered.reduce((s, r) => s + Number(r.amount ?? 0), 0)
    return { count: filtered.length, hours, amount }
  }, [filtered])

  function rowToExport(r: OtRow) {
    return {
      date: fmtReportDate(r.ot_date),
      employee_code: r.employees?.employee_code ?? '',
      employee_name: r.employees?.full_name ?? '',
      department: r.employees?.departments?.name ?? '',
      designation: r.employees?.designations?.title ?? '',
      time_in: fmtTime(r.start_time),
      time_out: fmtTime(r.end_time),
      hours: hoursOf(r).toFixed(2),
      amount: r.amount ?? 0,
      ot_type: r.ot_type,
      status: r.status,
      approval_by: approvalBy(r),
      ot_no: r.ot_no,
    }
  }

  function exportCsv() {
    const data =
      groupMode === 'date'
        ? sortedByDate.map(rowToExport)
        : employeeGroups.flatMap((g) =>
            g.rows.map((r) => ({
              ...rowToExport(r),
              group_employee: `${g.code} ${g.name}`,
            }))
          )
    downloadCsv(`overtime-report-${from}-to-${to}.csv`, toCsv(data))
  }

  function renderDataRow(r: OtRow) {
    return (
      <tr key={r.id} className="border-t hover:bg-muted/20">
        <td className="px-3 py-2 whitespace-nowrap">{fmtReportDate(r.ot_date)}</td>
        <td className="px-3 py-2 font-mono text-xs">{r.employees?.employee_code ?? '—'}</td>
        <td className="px-3 py-2">{r.employees?.full_name ?? '—'}</td>
        <td className="px-3 py-2 text-xs">{r.employees?.departments?.name ?? '—'}</td>
        <td className="px-3 py-2 text-xs">{r.employees?.designations?.title ?? '—'}</td>
        <td className="px-3 py-2 text-xs tabular-nums">{fmtTime(r.start_time)}</td>
        <td className="px-3 py-2 text-xs tabular-nums">{fmtTime(r.end_time)}</td>
        <td className="px-3 py-2 text-right tabular-nums font-medium">{hoursOf(r).toFixed(2)} h</td>
        <td className="px-3 py-2 text-right tabular-nums">
          {r.amount != null ? formatPkr(Number(r.amount)) : '—'}
          <div className="text-[10px] text-muted-foreground">{r.ot_type}</div>
        </td>
        <td className="px-3 py-2 text-xs capitalize">{approvalBy(r)}</td>
        <td className="px-3 py-2">
          <Badge variant="outline" className="text-[10px]">
            {r.status}
          </Badge>
        </td>
      </tr>
    )
  }

  const tableHead = (
    <thead className="bg-muted/40 text-xs text-muted-foreground report-table">
      <tr>
        <th className="text-left px-3 py-2">Date</th>
        <th className="text-left px-3 py-2">Code</th>
        <th className="text-left px-3 py-2">Employee</th>
        <th className="text-left px-3 py-2">Department</th>
        <th className="text-left px-3 py-2">Designation</th>
        <th className="text-left px-3 py-2">Time in</th>
        <th className="text-left px-3 py-2">Time out</th>
        <th className="text-right px-3 py-2">Hours</th>
        <th className="text-right px-3 py-2">Amount / Type</th>
        <th className="text-left px-3 py-2">Approval by</th>
        <th className="text-left px-3 py-2">Status</th>
      </tr>
    </thead>
  )

  return (
    <div className="space-y-4">
      <style>{printableStyles}</style>
      <ReportBackLink />
      <PageHeader
        title="Overtime report"
        description="Date-wise and employee-wise overtime — hours, pay amount, type and approver."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="h-4 w-4" /> Print
            </Button>
            <Button size="sm" onClick={exportCsv} disabled={filtered.length === 0}>
              <Download className="h-4 w-4" /> CSV
            </Button>
          </>
        }
      />

      <FilterBar>
        <div>
          <Label className="text-xs">From</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">To</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="min-w-[140px]">
          <Label className="text-xs">Status</Label>
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'active' | 'all')}>
            <option value="active">Pending / Approved / Paid</option>
            <option value="all">All (incl. rejected)</option>
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
        <div className="min-w-[160px]">
          <Label className="text-xs">View</Label>
          <Select value={groupMode} onChange={(e) => setGroupMode(e.target.value as GroupMode)}>
            <option value="date">Date-wise</option>
            <option value="employee">Employee-wise</option>
          </Select>
        </div>
      </FilterBar>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-5">
            <div className="text-xs text-muted-foreground">Records</div>
            <div className="text-2xl font-semibold tabular-nums">{totals.count}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="text-xs text-muted-foreground">Total hours</div>
            <div className="text-2xl font-semibold tabular-nums">{fmtNum(totals.hours, 2)} h</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="text-xs text-muted-foreground">Total amount</div>
            <div className="text-2xl font-semibold tabular-nums">PKR {fmtMoney(totals.amount)}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {loading ? (
            <div className="p-12 grid place-items-center">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">
              No overtime in this period.
            </div>
          ) : (
            <table className="w-full text-sm min-w-[960px]">
              {tableHead}
              <tbody>
                {groupMode === 'date' &&
                  sortedByDate.map((r) => renderDataRow(r))}

                {groupMode === 'employee' &&
                  employeeGroups.map((g) => {
                    const gHours = g.rows.reduce((s, r) => s + hoursOf(r), 0)
                    const gAmt = g.rows.reduce((s, r) => s + Number(r.amount ?? 0), 0)
                    return (
                      <Fragment key={g.code}>
                        <tr className="border-t bg-muted/50">
                          <td colSpan={11} className="px-3 py-2 font-medium">
                            <span className="font-mono text-xs mr-2">{g.code}</span>
                            {g.name}
                            <span className="text-muted-foreground font-normal text-xs ml-2">
                              {g.dept}
                              {g.designation ? ` · ${g.designation}` : ''}
                            </span>
                            <span className="float-right text-xs tabular-nums">
                              {fmtNum(gHours, 2)} h · PKR {fmtMoney(gAmt)}
                            </span>
                          </td>
                        </tr>
                        {g.rows.map((r) => renderDataRow(r))}
                      </Fragment>
                    )
                  })}

                <tr className="border-t bg-muted/30 font-semibold">
                  <td colSpan={7} className="px-3 py-2 text-right">
                    Total
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtNum(totals.hours, 2)} h</td>
                  <td className="px-3 py-2 text-right tabular-nums">PKR {fmtMoney(totals.amount)}</td>
                  <td colSpan={2} />
                </tr>
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
