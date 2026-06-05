import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus,
  RefreshCw,
  Loader2,
  Wallet,
  PlayCircle,
  ChevronRight,
  CalendarRange,
  CheckCircle2,
  CircleDashed,
  Lock,
  Trash2,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { writeAuditLog } from '@/lib/audit'
import { nextCode } from '@/lib/codegen'
import { PageHeader } from '@/components/master/PageHeader'
import { HasPermission } from '@/components/HasPermission'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
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
import { runPayrollForPeriod, validatePayrollRun, fmtPKR } from '@/lib/payroll'
import { toLocalDateIso } from '@/lib/utils'

type Period = {
  id: string
  code: string
  name: string
  frequency: 'MONTHLY' | 'SEMI_MONTHLY' | 'WEEKLY'
  period_start: string
  period_end: string
  pay_date: string | null
  status: 'DRAFT' | 'PROCESSING' | 'FINALIZED' | 'RELEASED' | 'PAID'
  notes: string | null
}

type Run = {
  id: string
  period_id: string
  run_at: string
  status: string
  total_employees: number
  total_gross: number
  total_deductions: number
  total_employer_cost: number
  total_net: number
}

const statusVariant = (s: Period['status']) => {
  switch (s) {
    case 'PAID':
      return 'success'
    case 'RELEASED':
      return 'success'
    case 'FINALIZED':
      return 'warm'
    case 'PROCESSING':
      return 'secondary'
    default:
      return 'outline'
  }
}

const statusIcon = (s: Period['status']) => {
  if (s === 'PAID' || s === 'RELEASED') return <CheckCircle2 className="h-3 w-3" />
  if (s === 'FINALIZED') return <Lock className="h-3 w-3" />
  return <CircleDashed className="h-3 w-3" />
}

function defaultMonthlyPeriod(): {
  name: string
  period_start: string
  period_end: string
  pay_date: string
  frequency: Period['frequency']
  notes: string
} {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  const start = new Date(y, m, 1)
  const end = new Date(y, m + 1, 0)
  const pay = new Date(y, m + 1, 5)
  const iso = toLocalDateIso
  const label = start.toLocaleString(undefined, { month: 'long', year: 'numeric' })
  return {
    name: label,
    period_start: iso(start),
    period_end: iso(end),
    pay_date: iso(pay),
    frequency: 'MONTHLY',
    notes: '',
  }
}

export function PayrollPage() {
  const navigate = useNavigate()
  const { appUser, hasPermission } = useAuth()
  const canRun = hasPermission('payroll.run')
  const [periods, setPeriods] = useState<Period[]>([])
  const [runs, setRuns] = useState<Run[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(defaultMonthlyPeriod())
  const [creating, setCreating] = useState(false)
  const [runningId, setRunningId] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const [p, r] = await Promise.all([
      supabase
        .from('payroll_periods')
        .select('*')
        .order('period_start', { ascending: false })
        .limit(36),
      supabase.from('payroll_runs').select('*').order('run_at', { ascending: false }).limit(50),
    ])
    if (p.error) toast.error('Failed to load periods', { description: p.error.message })
    else setPeriods((p.data ?? []) as Period[])
    setRuns((r.data ?? []) as Run[])
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  const latestRunByPeriod = useMemo(() => {
    const map = new Map<string, Run>()
    for (const r of runs) {
      if (!map.has(r.period_id)) map.set(r.period_id, r)
    }
    return map
  }, [runs])

  const openCreate = async () => {
    const code = await nextCode({
      table: 'payroll_periods',
      column: 'code',
      prefix: 'PR-',
      width: 4,
      companyId: appUser?.company_id,
    })
    setForm({ ...defaultMonthlyPeriod() })
    setOpen(true)
    // stash code in dataset to avoid re-shape of form interface
    ;(window as unknown as { __pr_code: string }).__pr_code = code
  }

  const createPeriod = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!appUser) return
    setCreating(true)
    const code = (window as unknown as { __pr_code: string }).__pr_code
    const payload = {
      company_id: appUser.company_id,
      code,
      name: form.name.trim(),
      frequency: form.frequency,
      period_start: form.period_start,
      period_end: form.period_end,
      pay_date: form.pay_date || null,
      notes: form.notes.trim() || null,
      created_by: appUser.id,
    }
    const { data, error } = await supabase
      .from('payroll_periods')
      .insert(payload)
      .select('id')
      .single()
    setCreating(false)
    if (error) {
      toast.error('Create failed', { description: error.message })
      return
    }
    await writeAuditLog({ action: 'CREATE', entityType: 'payroll_period', entityId: data?.id, after: payload })
    toast.success('Period created')
    setOpen(false)
    void load()
  }

  const runPayroll = async (period: Period) => {
    if (!appUser) return
    if (period.status === 'PAID') {
      toast.error('Period is already PAID')
      return
    }
    const existing = latestRunByPeriod.get(period.id)
    if (existing) {
      const yes = window.confirm(
        `A run already exists for this period (${existing.total_employees} payslips). Running again will create a new set of payslips. Continue?`
      )
      if (!yes) return
    }

    try {
      const validation = await validatePayrollRun(period.id, appUser.company_id)
      if (validation.warnings.length > 0) {
        const proceed = window.confirm(
          `${validation.warnings.join('\n\n')}\n\nContinue with payroll run anyway?`
        )
        if (!proceed) return
      }
    } catch (err) {
      toast.error('Validation failed', { description: (err as Error).message })
      return
    }

    setRunningId(period.id)
    try {
      const { runId, payslipCount } = await runPayrollForPeriod(period.id, appUser.company_id)
      await writeAuditLog({
        action: 'UPDATE',
        entityType: 'payroll_period',
        entityId: period.id,
        after: { run_id: runId, payslips: payslipCount },
      })
      toast.success(`Payroll run completed — ${payslipCount} payslip(s) generated`)
      void load()
      navigate(`/payroll/${period.id}`)
    } catch (err) {
      toast.error('Payroll run failed', { description: (err as Error).message })
    } finally {
      setRunningId(null)
    }
  }

  const deletePeriod = async (period: Period) => {
    const r = latestRunByPeriod.get(period.id)
    const payslipNote = r
      ? `\n\nThis will permanently delete ${r.total_employees} payslip(s) and all related data.`
      : ''
    const msg = `Delete payroll period "${period.name}" (${period.code})?\nStatus: ${period.status}${payslipNote}`
    if (!window.confirm(msg)) return

    const { error } = await supabase.from('payroll_periods').delete().eq('id', period.id)
    if (error) {
      toast.error('Delete failed', { description: error.message })
      return
    }
    await writeAuditLog({
      action: 'DELETE',
      entityType: 'payroll_period',
      entityId: period.id,
      before: { code: period.code, name: period.name, status: period.status },
    })
    toast.success('Period deleted')
    void load()
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payroll"
        description="Create payroll periods, run the engine, and review payslips."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate('/payroll/components')}>
              Components
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate('/payroll/tax-slabs')}>
              Tax slabs
            </Button>
            <HasPermission perm="payroll.run">
              <Button size="sm" onClick={() => void openCreate()}>
                <Plus className="h-4 w-4" /> New period
              </Button>
            </HasPermission>
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Periods</CardTitle>
          <CardDescription>{periods.length} on record</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-12 grid place-items-center">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : periods.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">
              <Wallet className="h-8 w-8 mx-auto mb-3 opacity-50" />
              No payroll periods yet.
              {canRun && (
                <div className="mt-4">
                  <Button size="sm" onClick={() => void openCreate()}>
                    <Plus className="h-4 w-4" /> Create first period
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="divide-y">
              {periods.map((p) => {
                const r = latestRunByPeriod.get(p.id)
                return (
                  <div
                    key={p.id}
                    className="flex flex-wrap items-center gap-3 px-6 py-4 hover:bg-muted/30"
                  >
                    <CalendarRange className="h-5 w-5 text-muted-foreground" />
                    <div className="min-w-[180px]">
                      <div className="font-medium">{p.name}</div>
                      <div className="text-xs text-muted-foreground font-mono">{p.code} · {p.frequency}</div>
                    </div>
                    <div className="text-sm text-muted-foreground min-w-[200px]">
                      {p.period_start} → {p.period_end}
                      {p.pay_date && <span className="block text-xs">Pay: {p.pay_date}</span>}
                    </div>
                    <Badge variant={statusVariant(p.status)} className="gap-1">
                      {statusIcon(p.status)} {p.status}
                    </Badge>
                    {r ? (
                      <div className="text-sm tabular-nums ml-auto">
                        <div className="text-right text-xs text-muted-foreground">
                          {r.total_employees} payslip(s)
                        </div>
                        <div className="font-medium">Net {fmtPKR(Number(r.total_net))}</div>
                      </div>
                    ) : (
                      <div className="ml-auto text-xs text-muted-foreground">No run yet</div>
                    )}
                    <div className="flex items-center gap-1">
                      {canRun && p.status === 'DRAFT' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => navigate(`/payroll/${p.id}?generate=1`)}
                        >
                          <PlayCircle className="h-4 w-4" />
                          Generate
                        </Button>
                      )}
                      {r && (
                        <Button size="sm" variant="ghost" onClick={() => navigate(`/payroll/${p.id}`)}>
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      )}
                      {canRun && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => void deletePeriod(p)}
                          title="Delete period"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New payroll period</DialogTitle>
            <DialogDescription>
              The engine computes payslips from each employee's salary slice, attendance, and approved leave.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={createPeriod} className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2 sm:col-span-2">
                <Label>Name</Label>
                <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Frequency</Label>
                <Select
                  value={form.frequency}
                  onChange={(e) => setForm({ ...form, frequency: e.target.value as Period['frequency'] })}
                >
                  <option value="MONTHLY">Monthly</option>
                  <option value="SEMI_MONTHLY">Semi-monthly (15-day)</option>
                  <option value="WEEKLY">Weekly</option>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Pay date</Label>
                <Input
                  type="date"
                  value={form.pay_date}
                  onChange={(e) => setForm({ ...form, pay_date: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Period start</Label>
                <Input
                  required
                  type="date"
                  value={form.period_start}
                  onChange={(e) => setForm({ ...form, period_start: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Period end</Label>
                <Input
                  required
                  type="date"
                  value={form.period_end}
                  onChange={(e) => setForm({ ...form, period_end: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  For a full month use 1st to last day (e.g. May 2026 = 2026-05-01 → 2026-05-31).
                </p>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Notes</Label>
                <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={creating}>
                {creating && <Loader2 className="h-4 w-4 animate-spin" />}
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
