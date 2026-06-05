import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Download,
  Loader2,
  RefreshCw,
  Lock,
  CheckCircle2,
  Search,
  PlayCircle,
  Eye,
  Send,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { writeAuditLog } from '@/lib/audit'
import {
  fmtPKR,
  previewPayrollRun,
  runPayrollForPeriod,
  releasePayslips,
  validatePayrollRun,
  type PreviewPayslipRow,
  type PayrollScope,
} from '@/lib/payroll'
import { downloadCsv, toCsv } from '@/lib/csv'
import { PageHeader } from '@/components/master/PageHeader'
import { EmployeeSearchSelect } from '@/components/master/EmployeeSearchSelect'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from 'sonner'

type Period = {
  id: string
  code: string
  name: string
  frequency: string
  period_start: string
  period_end: string
  pay_date: string | null
  status: string
}

type Run = {
  id: string
  total_employees: number
  total_gross: number
  total_deductions: number
  total_employer_cost: number
  total_net: number
  status: string
  run_at: string
}

type Payslip = {
  id: string
  employee_id: string
  employee_code: string
  employee_name: string
  designation: string | null
  department: string | null
  branch: string | null
  basic: number
  gross_earnings: number
  total_deductions: number
  employer_contrib: number
  tax_amount: number
  net_pay: number
  status: string
  paid_leave_days: number
  unpaid_leave_days: number
  absent_days: number
  present_days: number
}

type Dept = { id: string; name: string }
type EmpOption = { id: string; employee_code: string; full_name: string }

type ScopeMode = 'all' | 'department' | 'employee'

export function PayrollPeriodDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { appUser, hasPermission } = useAuth()
  const canRun = hasPermission('payroll.run')
  const canRelease = hasPermission('payroll.release')
  const [period, setPeriod] = useState<Period | null>(null)
  const [run, setRun] = useState<Run | null>(null)
  const [slips, setSlips] = useState<Payslip[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')

  const [departments, setDepartments] = useState<Dept[]>([])
  const [allEmployees, setAllEmployees] = useState<EmpOption[]>([])
  const [scopeMode, setScopeMode] = useState<ScopeMode>('all')
  const [departmentId, setDepartmentId] = useState('')
  const [employeeId, setEmployeeId] = useState('')
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewRows, setPreviewRows] = useState<PreviewPayslipRow[]>([])
  const [previewLoading, setPreviewLoading] = useState(false)
  const [posting, setPosting] = useState(false)
  const [replacePosted, setReplacePosted] = useState(false)
  const [releasing, setReleasing] = useState(false)

  const activeEmployeeCount = useMemo(() => allEmployees.length, [allEmployees])

  function buildScope(): PayrollScope | undefined {
    if (scopeMode === 'department' && departmentId) return { departmentId }
    if (scopeMode === 'employee' && employeeId) return { employeeIds: [employeeId] }
    return undefined
  }

  async function loadLookups() {
    if (!appUser) return
    const [d, e] = await Promise.all([
      supabase.from('departments').select('id, name').eq('company_id', appUser.company_id).order('name'),
      supabase
        .from('employees')
        .select('id, employee_code, full_name')
        .eq('company_id', appUser.company_id)
        .eq('is_active', true)
        .order('full_name'),
    ])
    setDepartments((d.data ?? []) as Dept[])
    setAllEmployees((e.data ?? []) as EmpOption[])
  }

  async function load() {
    if (!id) return
    setLoading(true)
    const [p, r] = await Promise.all([
      supabase.from('payroll_periods').select('*').eq('id', id).single(),
      supabase
        .from('payroll_runs')
        .select('*')
        .eq('period_id', id)
        .order('run_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
    if (p.error || !p.data) {
      toast.error('Period not found', { description: p.error?.message })
      setLoading(false)
      return
    }
    setPeriod(p.data as Period)
    setRun((r.data as Run) ?? null)

    const ps = await supabase
      .from('payslips')
      .select(
        'id, employee_id, employee_code, employee_name, designation, department, branch, basic, gross_earnings, total_deductions, employer_contrib, tax_amount, net_pay, status, paid_leave_days, unpaid_leave_days, absent_days, present_days'
      )
      .eq('period_id', id)
      .order('employee_code')
    setSlips((ps.data ?? []) as Payslip[])
    setLoading(false)
  }

  useEffect(() => {
    void loadLookups()
    void load()
  }, [id])

  useEffect(() => {
    if (!previewOpen || !id || !appUser) return
    void (async () => {
      setPreviewLoading(true)
      try {
        const rows = await previewPayrollRun(id, appUser.company_id, buildScope(), {
          includePosted: replacePosted,
        })
        setPreviewRows(rows)
      } catch {
        /* preview dialog handles errors on open */
      } finally {
        setPreviewLoading(false)
      }
    })()
  }, [replacePosted])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return slips
    return slips.filter(
      (s) =>
        s.employee_code.toLowerCase().includes(q) ||
        s.employee_name.toLowerCase().includes(q) ||
        (s.department ?? '').toLowerCase().includes(q) ||
        (s.designation ?? '').toLowerCase().includes(q)
    )
  }, [slips, query])

  const draftCount = useMemo(() => slips.filter((s) => s.status === 'DRAFT').length, [slips])
  const postedCount = slips.length

  const previewTotals = useMemo(() => {
    const postable = previewRows.filter(
      (r) => r.salaryOk && r.attendanceOk && (replacePosted || !r.alreadyPosted)
    )
    return {
      count: postable.length,
      net: postable.reduce((s, r) => s + r.net_pay, 0),
      gross: postable.reduce((s, r) => s + r.gross_earnings, 0),
    }
  }, [previewRows, replacePosted])

  const exportCsv = () => {
    if (slips.length === 0) {
      toast.error('No payslips to export')
      return
    }
    const csv = toCsv(
      slips.map((s) => ({
        employee_code: s.employee_code,
        employee_name: s.employee_name,
        department: s.department ?? '',
        designation: s.designation ?? '',
        branch: s.branch ?? '',
        present_days: s.present_days,
        paid_leave: s.paid_leave_days,
        unpaid_leave: s.unpaid_leave_days,
        absent_days: s.absent_days,
        basic: s.basic,
        gross_earnings: s.gross_earnings,
        total_deductions: s.total_deductions,
        tax_amount: s.tax_amount,
        employer_contrib: s.employer_contrib,
        net_pay: s.net_pay,
      }))
    )
    downloadCsv(`payroll-${period?.code}.csv`, csv)
  }

  const openPreview = async () => {
    if (!id || !appUser) return
    if (scopeMode === 'department' && !departmentId) {
      toast.error('Select a department')
      return
    }
    if (scopeMode === 'employee' && !employeeId) {
      toast.error('Select an employee')
      return
    }
    setPreviewLoading(true)
    setPreviewOpen(true)
    try {
      const rows = await previewPayrollRun(id, appUser.company_id, buildScope(), {
        includePosted: replacePosted,
      })
      setPreviewRows(rows)
      if (rows.length === 0) {
        toast.info('No employees to preview — all in scope may already be posted')
      }
    } catch (err) {
      toast.error('Preview failed', { description: (err as Error).message })
      setPreviewOpen(false)
    } finally {
      setPreviewLoading(false)
    }
  }

  const postPayslips = async () => {
    if (!id || !appUser || !period) return
    const postable = previewRows.filter(
      (r) => r.salaryOk && r.attendanceOk && (replacePosted || !r.alreadyPosted)
    )
    if (postable.length === 0) {
      toast.error('No payslips ready to post (check salary, attendance, or already posted)')
      return
    }
    if (replacePosted) {
      const ok = window.confirm(
        'Replace existing payslips for employees in this scope? Old payslip lines will be deleted and recalculated.'
      )
      if (!ok) return
    }
    try {
      const validation = await validatePayrollRun(id, appUser.company_id, buildScope())
      if (validation.warnings.length > 0) {
        const hasMissing = validation.missingSalary.length > 0
        const suffix = hasMissing
          ? 'Post anyway (employees without compensation will be skipped)?'
          : 'Continue posting?'
        const proceed = window.confirm(`${validation.warnings.join('\n\n')}\n\n${suffix}`)
        if (!proceed) return
      }
    } catch (err) {
      toast.error('Validation failed', { description: (err as Error).message })
      return
    }

    setPosting(true)
    try {
      const { payslipCount, skippedCount } = await runPayrollForPeriod(id, appUser.company_id, buildScope(), {
        finalizePeriod: false,
        replaceExisting: replacePosted,
      })
      await writeAuditLog({
        action: 'UPDATE',
        entityType: 'payroll_period',
        entityId: id,
        after: { scope: scopeMode, payslips: payslipCount, skipped: skippedCount },
      })
      toast.success(`Posted ${payslipCount} payslip(s)${skippedCount ? ` · ${skippedCount} skipped` : ''}`)
      setPreviewOpen(false)
      void load()
    } catch (err) {
      toast.error('Post failed', { description: (err as Error).message })
    } finally {
      setPosting(false)
    }
  }

  const releaseDraft = async () => {
    if (!id) return
    const deptName =
      scopeMode === 'department' && departmentId
        ? departments.find((d) => d.id === departmentId)?.name
        : undefined
    const label = deptName ? `department "${deptName}"` : scopeMode === 'employee' ? 'selected employee' : 'all draft'
    if (!window.confirm(`Release ${label} payslips (DRAFT → FINAL)?`)) return

    setReleasing(true)
    try {
      const count = await releasePayslips(id, {
        departmentName: deptName,
        employeeIds: scopeMode === 'employee' && employeeId ? [employeeId] : undefined,
      })
      if (count === 0) toast.info('No DRAFT payslips to release for this scope')
      else toast.success(`Released ${count} payslip(s)`)
      void load()
    } catch (err) {
      toast.error('Release failed', { description: (err as Error).message })
    } finally {
      setReleasing(false)
    }
  }

  const closePeriod = async () => {
    if (!period) return
    if (!window.confirm('Close this payroll period (mark FINALIZED)?')) return
    const { error } = await supabase
      .from('payroll_periods')
      .update({ status: 'FINALIZED', finalized_at: new Date().toISOString() })
      .eq('id', period.id)
    if (error) {
      toast.error('Update failed', { description: error.message })
      return
    }
    toast.success('Period finalized')
    void load()
  }

  const finalize = async (newStatus: 'RELEASED' | 'PAID') => {
    if (!period) return
    if (!window.confirm(`Mark period as ${newStatus}?`)) return
    const update: Record<string, unknown> = { status: newStatus }
    const { error } = await supabase.from('payroll_periods').update(update).eq('id', period.id)
    if (error) {
      toast.error('Update failed', { description: error.message })
      return
    }
    const slipStatus = newStatus === 'PAID' ? 'PAID' : 'FINAL'
    await supabase.from('payslips').update({ status: slipStatus }).eq('period_id', period.id)
    await writeAuditLog({ action: 'UPDATE', entityType: 'payroll_period', entityId: period.id, after: { status: newStatus } })
    toast.success(`Period marked ${newStatus}`)
    void load()
  }

  if (loading) {
    return (
      <div className="p-12 grid place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (!period) return null

  const canGenerate = canRun && (period.status === 'DRAFT' || period.status === 'PROCESSING')

  return (
    <div className="space-y-6">
      <PageHeader
        title={period.name}
        description={`${period.period_start} → ${period.period_end} · ${period.frequency}${period.pay_date ? ` · Pay date ${period.pay_date}` : ''}`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => navigate('/payroll')}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={slips.length === 0}>
              <Download className="h-4 w-4" /> Export CSV
            </Button>
            {canGenerate && postedCount > 0 && (
              <Button variant="outline" size="sm" onClick={() => void closePeriod()}>
                <Lock className="h-4 w-4" /> Close period
              </Button>
            )}
            {canRelease && period.status === 'FINALIZED' && (
              <Button size="sm" onClick={() => void finalize('RELEASED')}>
                <CheckCircle2 className="h-4 w-4" /> Release all
              </Button>
            )}
            {canRelease && period.status === 'RELEASED' && (
              <Button size="sm" onClick={() => void finalize('PAID')}>
                <CheckCircle2 className="h-4 w-4" /> Mark paid
              </Button>
            )}
          </>
        }
      />

      {canGenerate && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Generate payslips</CardTitle>
            <CardDescription>
              Select scope, preview salary &amp; attendance (including weekend worked days), then post.
              Posted: {postedCount}
              {activeEmployeeCount > 0 ? ` / ${activeEmployeeCount} active` : ''}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-4 items-end">
              <div className="space-y-2">
                <Label>Scope</Label>
                <div className="flex flex-wrap gap-3 text-sm">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="scope"
                      checked={scopeMode === 'all'}
                      onChange={() => setScopeMode('all')}
                    />
                    All employees
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="scope"
                      checked={scopeMode === 'department'}
                      onChange={() => setScopeMode('department')}
                    />
                    Department
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="scope"
                      checked={scopeMode === 'employee'}
                      onChange={() => setScopeMode('employee')}
                    />
                    One employee
                  </label>
                </div>
              </div>
              {scopeMode === 'department' && (
                <div className="space-y-2 min-w-[200px]">
                  <Label>Department</Label>
                  <Select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                    <option value="">Select…</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
              {scopeMode === 'employee' && (
                <div className="space-y-2 min-w-[260px]">
                  <Label>Employee</Label>
                  <EmployeeSearchSelect
                    employees={allEmployees}
                    value={employeeId}
                    onChange={setEmployeeId}
                    listMaxHeightClass="max-h-48"
                  />
                </div>
              )}
              <Button size="sm" onClick={() => void openPreview()} disabled={previewLoading}>
                {previewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                Preview
              </Button>
              {draftCount > 0 && canRelease && (
                <Button size="sm" variant="outline" disabled={releasing} onClick={() => void releaseDraft()}>
                  {releasing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Release draft ({draftCount})
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {run ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Employees</CardDescription>
              <CardTitle className="text-2xl tabular-nums">{slips.length || run.total_employees}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total gross</CardDescription>
              <CardTitle className="text-xl tabular-nums">
                {fmtPKR(slips.reduce((s, x) => s + Number(x.gross_earnings), 0) || Number(run.total_gross))}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total deductions</CardDescription>
              <CardTitle className="text-xl tabular-nums">
                {fmtPKR(slips.reduce((s, x) => s + Number(x.total_deductions), 0) || Number(run.total_deductions))}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Employer contribution</CardDescription>
              <CardTitle className="text-xl tabular-nums">
                {fmtPKR(slips.reduce((s, x) => s + Number(x.employer_contrib), 0) || Number(run.total_employer_cost))}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total net</CardDescription>
              <CardTitle className="text-xl tabular-nums text-emerald-600">
                {fmtPKR(slips.reduce((s, x) => s + Number(x.net_pay), 0) || Number(run.total_net))}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>
      ) : (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No payslips posted yet. Use <strong>Preview</strong> above to review and post.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base">Payslips</CardTitle>
            <CardDescription>{filtered.length} shown</CardDescription>
          </div>
          <div className="relative w-72 max-w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search code, name, department…"
              className="pl-9"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">No payslips.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Code</th>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Dept / Designation</th>
                    <th className="px-4 py-3 text-right">Present</th>
                    <th className="px-4 py-3 text-right">PL</th>
                    <th className="px-4 py-3 text-right">UPL</th>
                    <th className="px-4 py-3 text-right">Basic</th>
                    <th className="px-4 py-3 text-right">Gross</th>
                    <th className="px-4 py-3 text-right">Deduct</th>
                    <th className="px-4 py-3 text-right">Tax</th>
                    <th className="px-4 py-3 text-right">Net</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map((s) => (
                    <tr
                      key={s.id}
                      className="cursor-pointer hover:bg-muted/30"
                      onClick={() => navigate(`/payroll/payslip/${s.id}`)}
                    >
                      <td className="px-4 py-3 font-mono text-xs">{s.employee_code}</td>
                      <td className="px-4 py-3 font-medium">{s.employee_name}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {s.department ?? '—'}
                        <div className="text-xs">{s.designation ?? '—'}</div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{s.present_days}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{s.paid_leave_days}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{s.unpaid_leave_days}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmtPKR(Number(s.basic))}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmtPKR(Number(s.gross_earnings))}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmtPKR(Number(s.total_deductions))}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmtPKR(Number(s.tax_amount))}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium">{fmtPKR(Number(s.net_pay))}</td>
                      <td className="px-4 py-3">
                        <Badge variant={s.status === 'PAID' ? 'success' : s.status === 'FINAL' ? 'warm' : 'outline'}>
                          {s.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Review before post</DialogTitle>
            <DialogDescription>
              Weekday present (or approved paid leave) is required before salary is calculated. Scheduled weekly
              off days from shift then count as paid rest days. Extra work on a weekly off with Present status is
              included separately. Employees with no attendance and no paid leave get Rs 0.
            </DialogDescription>
          </DialogHeader>
          {previewLoading ? (
            <div className="py-12 grid place-items-center">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : (
            <div className="overflow-auto flex-1 min-h-0 border rounded-md">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2">Employee</th>
                    <th className="text-left px-3 py-2">Dept</th>
                    <th className="text-right px-3 py-2">Weekday</th>
                    <th className="text-right px-3 py-2">Week off</th>
                    <th className="text-right px-3 py-2">Paid days</th>
                    <th className="text-right px-3 py-2">Basic</th>
                    <th className="text-right px-3 py-2">Gross</th>
                    <th className="text-right px-3 py-2">Net</th>
                    <th className="text-left px-3 py-2">Status</th>
                    <th className="text-left px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((r) => (
                    <tr key={r.employee_id} className="border-t">
                      <td className="px-3 py-2">
                        <div className="font-medium">{r.employee_name}</div>
                        <div className="text-xs text-muted-foreground font-mono">{r.employee_code}</div>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{r.department ?? '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.weekdayPresent}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.weeklyOffPaid}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.totalPaidDays}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtPKR(r.basic)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtPKR(r.gross_earnings)}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{fmtPKR(r.net_pay)}</td>
                      <td className="px-3 py-2">
                        {r.alreadyPosted ? (
                          <Badge variant="warm">Posted</Badge>
                        ) : !r.salaryOk ? (
                          <Badge variant="destructive">No salary</Badge>
                        ) : !r.attendanceOk ? (
                          <Badge variant="outline" className="text-muted-foreground">
                            No attendance
                          </Badge>
                        ) : r.salaryLateEffective ? (
                          <Badge variant="outline" className="border-amber-500 text-amber-700">
                            Ready (late date)
                          </Badge>
                        ) : (
                          <Badge variant="success">Ready</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Button variant="ghost" size="sm" asChild>
                          <Link to={`/employees/${r.employee_id}?tab=compensation`} target="_blank">
                            Edit
                          </Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {previewRows.length === 0 && (
                <p className="p-8 text-center text-sm text-muted-foreground">Nothing to preview for this scope.</p>
              )}
            </div>
          )}
          <DialogFooter className="flex-wrap gap-2 sm:justify-between">
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">
                {previewTotals.count} to post · Gross {fmtPKR(previewTotals.gross)} · Net {fmtPKR(previewTotals.net)}
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={replacePosted}
                  onCheckedChange={(v) => setReplacePosted(v === true)}
                />
                Replace already posted payslips (recalculate)
              </label>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setPreviewOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={posting || previewTotals.count === 0}
                onClick={() => void postPayslips()}
              >
                {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
                Post {previewTotals.count} payslip(s)
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
