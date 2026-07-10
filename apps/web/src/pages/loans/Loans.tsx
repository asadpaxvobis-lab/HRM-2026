import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus,
  RefreshCw,
  Loader2,
  Coins,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Clock,
  CircleDashed,
  PlayCircle,
  Lock,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { writeAuditLog } from '@/lib/audit'
import { PageHeader } from '@/components/master/PageHeader'
import { HasPermission } from '@/components/HasPermission'
import { EmployeeSearchSelect } from '@/components/master/EmployeeSearchSelect'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { buildSchedule, summarizeSchedule } from '@/lib/loans'

type Loan = {
  id: string
  loan_no: string
  employee_id: string
  approver_id: string | null
  loan_type_code: string | null
  loan_type_name: string | null
  purpose: string
  principal_amount: number
  interest_rate_pct: number
  installments: number
  monthly_installment: number
  total_payable: number
  outstanding_amount: number
  paid_amount: number
  start_date: string | null
  status: 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'ACTIVE' | 'CLOSED' | 'CANCELLED'
  requested_at: string
  employees?: { employee_code: string; full_name: string }
  approver?: { full_name: string | null; email: string } | null
}

type EmployeeOption = { id: string; employee_code: string; full_name: string }
type UserOption = { id: string; email: string; full_name: string | null }

type LoanType = {
  id: string
  code: string
  name: string
  max_amount: number | null
  max_installments: number | null
  interest_rate_pct: number
  is_active: boolean
}

type Tab = 'mine' | 'pending' | 'active' | 'all'

const statusVariant = (s: Loan['status']) => {
  switch (s) {
    case 'CLOSED':
      return 'success'
    case 'ACTIVE':
      return 'success'
    case 'APPROVED':
      return 'warm'
    case 'REQUESTED':
      return 'outline'
    case 'REJECTED':
    case 'CANCELLED':
      return 'destructive'
    default:
      return 'outline'
  }
}

const statusIcon = (s: Loan['status']) => {
  if (s === 'CLOSED') return <Lock className="h-3 w-3" />
  if (s === 'ACTIVE') return <PlayCircle className="h-3 w-3" />
  if (s === 'APPROVED') return <CheckCircle2 className="h-3 w-3" />
  if (s === 'REQUESTED') return <Clock className="h-3 w-3" />
  if (s === 'REJECTED' || s === 'CANCELLED') return <XCircle className="h-3 w-3" />
  return <CircleDashed className="h-3 w-3" />
}

export function LoansPage() {
  const navigate = useNavigate()
  const { appUser, hasPermission } = useAuth()
  const canApprove = hasPermission('loan.approve')
  const canView = hasPermission('loan.view')
  const canCreate = hasPermission('loan.create')
  const [tab, setTab] = useState<Tab>(canApprove ? 'pending' : 'mine')
  const [loans, setLoans] = useState<Loan[]>([])
  const [types, setTypes] = useState<LoanType[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [giveMode, setGiveMode] = useState(false)
  const [employees, setEmployees] = useState<EmployeeOption[]>([])
  const [approverUsers, setApproverUsers] = useState<UserOption[]>([])
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({
    employee_id: '',
    approver_id: '',
    loan_type_id: '',
    purpose: '',
    principal_amount: 0,
    installments: 3,
    interest_rate_pct: 0,
    start_date: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString().slice(0, 10),
  })

  const openLoanDialog = (forAnyEmployee: boolean) => {
    setGiveMode(forAnyEmployee)
    setForm((f) => ({
      ...f,
      employee_id: forAnyEmployee ? '' : (appUser?.employee_id ?? ''),
      approver_id: '',
      loan_type_id: '',
      purpose: '',
      principal_amount: 0,
      installments: 3,
    }))
    setOpen(true)
  }

  async function loadApproverUsers() {
    const { data, error } = await supabase
      .from('users')
      .select('id, email, full_name')
      .eq('status', 'Active')
      .order('full_name')
    if (error) {
      toast.error('Failed to load users', { description: error.message })
      return
    }
    setApproverUsers((data ?? []) as UserOption[])
  }

  async function loadEmployees() {
    const { data, error } = await supabase
      .from('employees')
      .select('id, employee_code, full_name')
      .eq('is_active', true)
      .order('full_name')
    if (error) {
      toast.error('Failed to load employees', { description: error.message })
      return
    }
    setEmployees((data ?? []) as EmployeeOption[])
  }

  async function load() {
    setLoading(true)
    let q = supabase
      .from('loans')
      .select(
        'id, loan_no, employee_id, approver_id, loan_type_code, loan_type_name, purpose, principal_amount, interest_rate_pct, installments, monthly_installment, total_payable, outstanding_amount, paid_amount, start_date, status, requested_at, employees(employee_code, full_name), approver:users!loans_approver_id_fkey(full_name, email)'
      )
      .order('requested_at', { ascending: false })
      .limit(200)

    if (tab === 'mine' && appUser?.employee_id) {
      q = q.eq('employee_id', appUser.employee_id)
    } else if (tab === 'pending') {
      q = q.eq('status', 'REQUESTED')
      if (appUser?.id) q = q.eq('approver_id', appUser.id)
    } else if (tab === 'active') {
      q = q.in('status', ['APPROVED', 'ACTIVE'])
    }

    const [{ data: ld, error }, { data: td }] = await Promise.all([
      q,
      supabase.from('loan_types').select('*').eq('is_active', true).order('name'),
    ])
    if (error) toast.error('Failed to load loans', { description: error.message })
    else {
      const mapped = (ld ?? []).map((r: Record<string, unknown>) => ({
        ...(r as object),
        employees: Array.isArray(r.employees) ? (r.employees as unknown[])[0] : r.employees,
        approver: Array.isArray(r.approver) ? (r.approver as unknown[])[0] : r.approver,
      })) as Loan[]
      setLoans(mapped)
    }
    setTypes((td ?? []) as LoanType[])
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [tab])

  useEffect(() => {
    if (open) {
      void loadApproverUsers()
      if (giveMode) void loadEmployees()
    }
  }, [open, giveMode])

  const tabs: { id: Tab; label: string; visible: boolean }[] = [
    { id: 'mine', label: 'My loans', visible: !!appUser?.employee_id },
    { id: 'pending', label: 'Sent to me for approval', visible: true },
    { id: 'active', label: 'Active', visible: canApprove || canView },
    { id: 'all', label: 'All', visible: canApprove || canView },
  ]
  const visibleTabs = tabs.filter((t) => t.visible)

  // Live amortization preview while creating
  const preview = useMemo(() => {
    if (!form.principal_amount || !form.installments) return null
    const schedule = buildSchedule(
      Number(form.principal_amount),
      Number(form.installments),
      Number(form.interest_rate_pct),
      form.start_date
    )
    return { schedule, summary: summarizeSchedule(schedule) }
  }, [form.principal_amount, form.installments, form.interest_rate_pct, form.start_date])

  const onTypeChange = (typeId: string) => {
    const t = types.find((x) => x.id === typeId)
    setForm((f) => ({
      ...f,
      loan_type_id: typeId,
      interest_rate_pct: t ? Number(t.interest_rate_pct) : f.interest_rate_pct,
      installments: t?.max_installments ? Math.min(f.installments, t.max_installments) : f.installments,
    }))
  }

  const totals = useMemo(() => {
    const sumOf = (filter: (l: Loan) => boolean, key: keyof Loan) =>
      loans.filter(filter).reduce((s, l) => s + Number(l[key]), 0)
    return {
      pending: sumOf((l) => l.status === 'REQUESTED', 'principal_amount'),
      activeOutstanding: sumOf((l) => l.status === 'ACTIVE' || l.status === 'APPROVED', 'outstanding_amount'),
      paid: sumOf((l) => l.status === 'CLOSED' || l.status === 'ACTIVE', 'paid_amount'),
    }
  }, [loans])

  const createLoan = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!appUser) return
    const employeeId = giveMode ? form.employee_id : appUser.employee_id
    if (!employeeId) {
      toast.error(giveMode ? 'Select an employee' : 'Your user account is not linked to an employee record')
      return
    }
    if (!form.approver_id) {
      toast.error('Select a user to send for approval')
      return
    }
    const t = types.find((x) => x.id === form.loan_type_id)
    if (t?.max_amount != null && Number(form.principal_amount) > Number(t.max_amount)) {
      toast.error(`Amount exceeds the max for ${t.name} (${t.max_amount})`)
      return
    }
    if (t?.max_installments != null && Number(form.installments) > Number(t.max_installments)) {
      toast.error(`Installments exceed the max for ${t.name} (${t.max_installments})`)
      return
    }
    if (!preview) {
      toast.error('Invalid amount or installments')
      return
    }
    setBusy(true)

    // Generate loan number scoped to year YYYY-NNN
    const yr = new Date().getFullYear()
    const { data: existing } = await supabase
      .from('loans')
      .select('loan_no')
      .eq('company_id', appUser.company_id)
      .ilike('loan_no', `LN-${yr}-%`)
      .order('loan_no', { ascending: false })
      .limit(1)
    let n = 1
    if (existing && existing.length > 0) {
      const m = (existing[0] as { loan_no: string }).loan_no.match(/(\d+)$/)
      if (m) n = parseInt(m[1], 10) + 1
    }
    const loan_no = `LN-${yr}-${String(n).padStart(4, '0')}`

    const payload = {
      company_id: appUser.company_id,
      loan_no,
      employee_id: employeeId,
      approver_id: form.approver_id,
      requested_by: appUser.id,
      loan_type_id: t?.id ?? null,
      loan_type_code: t?.code ?? null,
      loan_type_name: t?.name ?? null,
      purpose: form.purpose.trim(),
      principal_amount: Number(form.principal_amount),
      interest_rate_pct: Number(form.interest_rate_pct),
      installments: Number(form.installments),
      monthly_installment: preview.summary.emi,
      total_payable: preview.summary.totalPayable,
      outstanding_amount: preview.summary.totalPayable,
      paid_amount: 0,
      start_date: form.start_date,
      status: 'REQUESTED' as const,
    }
    const { data, error } = await supabase.from('loans').insert(payload).select('id').single()
    setBusy(false)
    if (error) {
      toast.error('Create failed', { description: error.message })
      return
    }
    await writeAuditLog({ action: 'CREATE', entityType: 'loan', entityId: data?.id, after: payload })
    toast.success(giveMode ? 'Loan sent for approval' : 'Loan request submitted')
    setOpen(false)
    navigate(`/loans/${data?.id}`)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Loans & advances"
        description="Request loans, view installment schedules, and approve outstanding requests."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate('/loans/types')}>
              Loan types
            </Button>
            {canApprove && (
              <Button size="sm" onClick={() => openLoanDialog(true)}>
                <Plus className="h-4 w-4" /> Give loan
              </Button>
            )}
            {canCreate && appUser?.employee_id && (
              <Button
                size="sm"
                variant={canApprove ? 'outline' : 'default'}
                onClick={() => openLoanDialog(false)}
              >
                <Plus className="h-4 w-4" /> Request loan
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Pending requests</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{totals.pending.toLocaleString()} PKR</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Active outstanding</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{totals.activeOutstanding.toLocaleString()} PKR</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total recovered</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{totals.paid.toLocaleString()} PKR</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {visibleTabs.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 border-b">
          {visibleTabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={
                'px-4 py-2 text-sm border-b-2 transition-colors -mb-px ' +
                (tab === t.id
                  ? 'border-primary text-primary font-medium'
                  : 'border-transparent text-muted-foreground hover:text-foreground')
              }
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-12 grid place-items-center">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : loans.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">
              <Coins className="h-8 w-8 mx-auto mb-3 opacity-50" />
              No loans here yet.
              {tab === 'mine' && canCreate && appUser?.employee_id && (
                <div className="mt-4">
                  <Button size="sm" onClick={() => openLoanDialog(false)}>
                    <Plus className="h-4 w-4" /> Request your first loan
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="divide-y">
              {loans.map((l) => (
                <div
                  key={l.id}
                  className="flex flex-wrap items-center gap-3 px-6 py-4 hover:bg-muted/30 cursor-pointer"
                  onClick={() => navigate(`/loans/${l.id}`)}
                >
                  <div className="min-w-[220px] flex-1">
                    <div className="font-medium">{l.purpose}</div>
                    <div className="text-xs text-muted-foreground font-mono">
                      {l.loan_no} · {l.loan_type_name ?? '—'}
                    </div>
                  </div>
                  {tab !== 'mine' && l.employees && (
                    <div className="text-sm text-muted-foreground min-w-[160px]">
                      <div className="font-medium text-foreground">{l.employees.full_name}</div>
                      <div className="text-xs font-mono">{l.employees.employee_code}</div>
                    </div>
                  )}
                  <div className="text-sm min-w-[140px] text-right">
                    <div className="font-medium tabular-nums">
                      {Number(l.principal_amount).toLocaleString()} PKR
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {l.installments} mo @ {Number(l.monthly_installment).toLocaleString()}/mo
                    </div>
                  </div>
                  {Number(l.outstanding_amount) > 0 && l.status !== 'REQUESTED' && l.status !== 'REJECTED' && (
                    <div className="text-xs text-right min-w-[110px]">
                      <div className="text-muted-foreground">Outstanding</div>
                      <div className="font-medium tabular-nums">{Number(l.outstanding_amount).toLocaleString()}</div>
                    </div>
                  )}
                  <Badge variant={statusVariant(l.status)} className="gap-1">
                    {statusIcon(l.status)} {l.status}
                  </Badge>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{giveMode ? 'Give loan to employee' : 'Request a loan'}</DialogTitle>
            <DialogDescription>
              {giveMode
                ? 'Choose employee, loan details, installments, and which user should approve.'
                : 'Choose loan details and which user should approve. Preview installments before submitting.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={createLoan} className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              {giveMode && (
                <div className="space-y-2 sm:col-span-2">
                  <Label>Employee</Label>
                  <EmployeeSearchSelect
                    employees={employees}
                    value={form.employee_id}
                    onChange={(employeeId) => setForm({ ...form, employee_id: employeeId })}
                    placeholder="Select employee…"
                  />
                </div>
              )}
              <div className="space-y-2 sm:col-span-2">
                <Label>Send for approval to</Label>
                <Select
                  required
                  value={form.approver_id}
                  onChange={(e) => setForm({ ...form, approver_id: e.target.value })}
                >
                  <option value="">Select user…</option>
                  {approverUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.full_name ?? u.email}
                      {u.id === appUser?.id ? ' (you)' : ''}
                    </option>
                  ))}
                </Select>
                <p className="text-xs text-muted-foreground">Active users in your company.</p>
              </div>
              <div className="space-y-2">
                <Label>Loan type</Label>
                <Select required value={form.loan_type_id} onChange={(e) => onTypeChange(e.target.value)}>
                  <option value="">Select…</option>
                  {types.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} {t.max_amount != null && ` · max ${t.max_amount}`}
                      {t.max_installments != null && ` · ${t.max_installments} mo`}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Annual interest (%)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  value={form.interest_rate_pct}
                  onChange={(e) => setForm({ ...form, interest_rate_pct: +e.target.value })}
                  disabled
                />
              </div>
              <div className="space-y-2">
                <Label>Amount (PKR)</Label>
                <Input
                  required
                  type="number"
                  min={1}
                  value={form.principal_amount}
                  onChange={(e) => setForm({ ...form, principal_amount: +e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Installments (months)</Label>
                <Input
                  required
                  type="number"
                  min={1}
                  value={form.installments}
                  onChange={(e) => setForm({ ...form, installments: +e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>First installment date</Label>
                <Input
                  required
                  type="date"
                  value={form.start_date}
                  onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Purpose / reason</Label>
                <Textarea
                  required
                  rows={2}
                  value={form.purpose}
                  onChange={(e) => setForm({ ...form, purpose: e.target.value })}
                />
              </div>
            </div>

            {preview && form.principal_amount > 0 && (
              <div className="border rounded-lg p-4 bg-muted/20 space-y-3">
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground">Monthly</div>
                    <div className="font-semibold tabular-nums">
                      {preview.summary.emi.toLocaleString()} PKR
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Total payable</div>
                    <div className="font-semibold tabular-nums">
                      {preview.summary.totalPayable.toLocaleString()} PKR
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Total interest</div>
                    <div className="font-semibold tabular-nums">
                      {preview.summary.totalInterest.toLocaleString()} PKR
                    </div>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  Schedule preview: {preview.schedule.length} installments starting{' '}
                  {preview.schedule[0]?.due_date} → ending {preview.schedule[preview.schedule.length - 1]?.due_date}
                </div>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={busy || !preview || form.principal_amount <= 0 || !form.approver_id}
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Submit request
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
