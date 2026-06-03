import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Loader2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  PlayCircle,
  Lock,
  Printer,
  AlertTriangle,
  Trash2,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { writeAuditLog } from '@/lib/audit'
import { PageHeader } from '@/components/master/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
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
import { buildSchedule } from '@/lib/loans'

type Loan = {
  id: string
  company_id: string
  loan_no: string
  employee_id: string
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
  end_date: string | null
  status: 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'ACTIVE' | 'CLOSED' | 'CANCELLED'
  requested_at: string
  decided_at: string | null
  decision_note: string | null
  approver_id: string | null
  disbursed_at: string | null
  closed_at: string | null
  notes: string | null
  employees?: { employee_code: string; full_name: string; email: string | null }
  approver?: { full_name: string | null; email: string } | null
}

type Installment = {
  id: string
  installment_no: number
  due_date: string
  amount: number
  principal_portion: number
  interest_portion: number
  status: 'PENDING' | 'PAID' | 'SKIPPED' | 'WAIVED'
  paid_at: string | null
  payroll_period_id: string | null
  paid_amount: number
  notes: string | null
}

const statusVariant = (s: Loan['status']) =>
  s === 'CLOSED'
    ? 'success'
    : s === 'ACTIVE'
      ? 'success'
      : s === 'APPROVED'
        ? 'warm'
        : s === 'REJECTED' || s === 'CANCELLED'
          ? 'destructive'
          : 'outline'

const installmentVariant = (s: Installment['status']) =>
  s === 'PAID' ? 'success' : s === 'SKIPPED' ? 'warm' : s === 'WAIVED' ? 'secondary' : 'outline'

export function LoanDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { appUser, hasPermission } = useAuth()
  const canApprove = hasPermission('loan.approve')
  const canUpdate = hasPermission('loan.update') || canApprove

  const [loan, setLoan] = useState<Loan | null>(null)
  const [installments, setInstallments] = useState<Installment[]>([])
  const [loading, setLoading] = useState(true)
  const [decisionOpen, setDecisionOpen] = useState<{ open: boolean; mode: 'approve' | 'reject' }>({
    open: false,
    mode: 'approve',
  })
  const [decisionNote, setDecisionNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [markOpen, setMarkOpen] = useState<Installment | null>(null)
  const [paidAmount, setPaidAmount] = useState<number>(0)
  const [paidDate, setPaidDate] = useState<string>(new Date().toISOString().slice(0, 10))

  async function load() {
    if (!id) return
    setLoading(true)
    const [{ data: l, error: le }, { data: ins, error: ie }] = await Promise.all([
      supabase
        .from('loans')
        .select('*, employees(employee_code, full_name, email), approver:users!loans_approver_id_fkey(full_name, email)')
        .eq('id', id)
        .single(),
      supabase
        .from('loan_installments')
        .select('*')
        .eq('loan_id', id)
        .order('installment_no'),
    ])
    if (le) {
      toast.error('Failed to load loan', { description: le.message })
      setLoading(false)
      return
    }
    if (ie) toast.error('Failed to load installments', { description: ie.message })
    const mapped = {
      ...(l as Record<string, unknown>),
      employees: Array.isArray((l as Record<string, unknown>)?.employees)
        ? ((l as Record<string, unknown>)?.employees as unknown[])[0]
        : (l as Record<string, unknown>)?.employees,
      approver: Array.isArray((l as Record<string, unknown>)?.approver)
        ? ((l as Record<string, unknown>)?.approver as unknown[])[0]
        : (l as Record<string, unknown>)?.approver,
    } as Loan
    setLoan(mapped)
    setInstallments((ins ?? []) as Installment[])
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [id])

  const isMine = loan?.employee_id && loan?.employee_id === appUser?.employee_id
  const canDecide =
    !!loan &&
    loan.status === 'REQUESTED' &&
    (loan.approver_id === appUser?.id || (canApprove && !loan.approver_id))

  const stats = useMemo(() => {
    const paidCount = installments.filter((i) => i.status === 'PAID').length
    const pendingCount = installments.filter((i) => i.status === 'PENDING').length
    return { paidCount, pendingCount, total: installments.length }
  }, [installments])

  async function activateLoanAccount(record: Loan): Promise<{ ok: boolean; error?: string }> {
    if (!record.start_date) {
      return { ok: false, error: 'First installment date is missing on this loan.' }
    }
    const sched = buildSchedule(
      Number(record.principal_amount),
      Number(record.installments),
      Number(record.interest_rate_pct),
      record.start_date
    )
    const endDate = sched[sched.length - 1].due_date
    const rows = sched.map((s) => ({
      loan_id: record.id,
      installment_no: s.installment_no,
      due_date: s.due_date,
      amount: s.amount,
      principal_portion: s.principal_portion,
      interest_portion: s.interest_portion,
    }))
    const { error: insErr } = await supabase.from('loan_installments').insert(rows)
    if (insErr) return { ok: false, error: insErr.message }

    const totalOutstanding = rows.reduce((s, r) => s + r.amount, 0)
    const { error: upErr } = await supabase
      .from('loans')
      .update({
        status: 'ACTIVE',
        disbursed_at: new Date().toISOString(),
        end_date: endDate,
        outstanding_amount: totalOutstanding,
      })
      .eq('id', record.id)
    if (upErr) return { ok: false, error: upErr.message }

    await writeAuditLog({
      action: 'UPDATE',
      entityType: 'loan',
      entityId: record.id,
      after: { status: 'ACTIVE', installments_generated: rows.length, outstanding_amount: totalOutstanding },
    })
    return { ok: true }
  }

  async function decide(approve: boolean, note: string) {
    if (!loan) return
    setBusy(true)
    if (!approve) {
      const { error } = await supabase
        .from('loans')
        .update({
          status: 'REJECTED',
          decided_at: new Date().toISOString(),
          decided_by: appUser?.id ?? null,
          decision_note: note || null,
        })
        .eq('id', loan.id)
      setBusy(false)
      if (error) {
        toast.error('Update failed', { description: error.message })
        return
      }
      await writeAuditLog({
        action: 'UPDATE',
        entityType: 'loan',
        entityId: loan.id,
        after: { status: 'REJECTED', decision_note: note },
      })
      toast.success('Loan rejected')
      setDecisionOpen({ open: false, mode: 'approve' })
      setDecisionNote('')
      void load()
      return
    }

    const { error } = await supabase
      .from('loans')
      .update({
        status: 'APPROVED',
        decided_at: new Date().toISOString(),
        decided_by: appUser?.id ?? null,
        decision_note: note || null,
      })
      .eq('id', loan.id)
    if (error) {
      setBusy(false)
      toast.error('Update failed', { description: error.message })
      return
    }

    const activated = await activateLoanAccount({ ...loan, status: 'APPROVED' })
    setBusy(false)
    setDecisionOpen({ open: false, mode: 'approve' })
    setDecisionNote('')

    if (!activated.ok) {
      await writeAuditLog({
        action: 'UPDATE',
        entityType: 'loan',
        entityId: loan.id,
        after: { status: 'APPROVED', decision_note: note, activate_failed: activated.error },
      })
      toast.error('Approved but employee account was not updated', { description: activated.error })
      void load()
      return
    }

    await writeAuditLog({
      action: 'UPDATE',
      entityType: 'loan',
      entityId: loan.id,
      after: { status: 'ACTIVE', decision_note: note },
    })
    toast.success('Loan approved — employee account updated with installment schedule')
    void load()
  }

  async function disburse() {
    if (!loan) return
    setBusy(true)
    const activated = await activateLoanAccount(loan)
    setBusy(false)
    if (!activated.ok) {
      toast.error('Disburse failed', { description: activated.error })
      return
    }
    toast.success('Loan disbursed; schedule generated')
    void load()
  }

  async function cancel() {
    if (!loan) return
    if (!window.confirm('Cancel this loan request?')) return
    const { error } = await supabase.from('loans').update({ status: 'CANCELLED' }).eq('id', loan.id)
    if (error) {
      toast.error('Cancel failed', { description: error.message })
      return
    }
    toast.success('Cancelled')
    void load()
  }

  async function deleteLoan() {
    if (!loan) return
    if (!window.confirm(`Delete loan ${loan.loan_no}? This cannot be undone.`)) return
    const { error } = await supabase.from('loans').delete().eq('id', loan.id)
    if (error) {
      toast.error('Delete failed', { description: error.message })
      return
    }
    toast.success('Loan deleted')
    navigate('/loans')
  }

  async function markInstallmentPaid(i: Installment, amount: number, on: string) {
    if (!loan) return
    setBusy(true)
    const paid = Math.max(0, amount)
    const { error: e1 } = await supabase
      .from('loan_installments')
      .update({
        status: 'PAID',
        paid_at: new Date(on + 'T12:00:00').toISOString(),
        paid_amount: paid,
      })
      .eq('id', i.id)
    if (e1) {
      setBusy(false)
      toast.error('Update failed', { description: e1.message })
      return
    }

    const newPaid = Number(loan.paid_amount) + paid
    const newOutstanding = Math.max(0, Number(loan.outstanding_amount) - paid)
    const allPaid = installments.every((row) => (row.id === i.id ? true : row.status !== 'PENDING'))
    const nextStatus = allPaid && newOutstanding <= 0.01 ? 'CLOSED' : loan.status
    await supabase
      .from('loans')
      .update({
        paid_amount: newPaid,
        outstanding_amount: newOutstanding,
        status: nextStatus,
        closed_at: nextStatus === 'CLOSED' ? new Date().toISOString() : loan.closed_at,
      })
      .eq('id', loan.id)
    await writeAuditLog({
      action: 'UPDATE',
      entityType: 'loan_installment',
      entityId: i.id,
      after: { installment_no: i.installment_no, paid_amount: paid },
    })
    toast.success(`Installment #${i.installment_no} marked paid`)
    setMarkOpen(null)
    setBusy(false)
    void load()
  }

  async function waiveInstallment(i: Installment) {
    if (!loan) return
    if (!window.confirm(`Waive installment #${i.installment_no} for ${i.amount.toLocaleString()} PKR?`)) return
    const { error } = await supabase
      .from('loan_installments')
      .update({ status: 'WAIVED' })
      .eq('id', i.id)
    if (error) {
      toast.error('Waive failed', { description: error.message })
      return
    }
    const newOutstanding = Math.max(0, Number(loan.outstanding_amount) - Number(i.amount))
    await supabase.from('loans').update({ outstanding_amount: newOutstanding }).eq('id', loan.id)
    toast.success('Waived')
    void load()
  }

  if (loading) {
    return (
      <div className="p-12 grid place-items-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  if (!loan) {
    return (
      <div className="p-12 text-center text-sm text-muted-foreground">
        <AlertTriangle className="h-8 w-8 mx-auto mb-3 opacity-50" /> Loan not found.
        <div className="mt-4">
          <Button variant="outline" size="sm" onClick={() => navigate('/loans')}>
            Back to list
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={loan.loan_no}
        description={`${loan.loan_type_name ?? 'Loan'} · ${loan.purpose}`}
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => navigate('/loans')}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="h-4 w-4" />
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div>
            <CardDescription>{loan.employees?.full_name}</CardDescription>
            <CardTitle className="text-base">
              {Number(loan.principal_amount).toLocaleString()} PKR · {loan.installments} months @{' '}
              {Number(loan.monthly_installment).toLocaleString()} /mo
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1 font-mono">
              {loan.employees?.employee_code} · {loan.employees?.email ?? '—'}
            </p>
          </div>
          <Badge variant={statusVariant(loan.status)} className="text-xs">
            {loan.status}
          </Badge>
        </CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-4 gap-4 text-sm">
            <Field label="Principal">{Number(loan.principal_amount).toLocaleString()} PKR</Field>
            <Field label="Interest rate">{Number(loan.interest_rate_pct).toFixed(2)}% p.a.</Field>
            <Field label="Total payable">{Number(loan.total_payable).toLocaleString()} PKR</Field>
            <Field label="Outstanding">{Number(loan.outstanding_amount).toLocaleString()} PKR</Field>
            <Field label="Requested">{new Date(loan.requested_at).toLocaleDateString()}</Field>
            <Field label="Start date">{loan.start_date ?? '—'}</Field>
            <Field label="End date">{loan.end_date ?? '—'}</Field>
            <Field label="Decided">{loan.decided_at ? new Date(loan.decided_at).toLocaleDateString() : '—'}</Field>
            {loan.status === 'REQUESTED' && loan.approver && (
              <Field label="Sent for approval to">
                {loan.approver.full_name ?? loan.approver.email}
              </Field>
            )}
          </div>
          {loan.decision_note && (
            <div className="mt-4 text-sm border-l-4 border-amber-500/60 pl-3">
              <div className="text-xs text-muted-foreground">Decision note</div>
              {loan.decision_note}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2 print:hidden">
        {canDecide && (
          <>
            <Button size="sm" onClick={() => setDecisionOpen({ open: true, mode: 'approve' })}>
              <CheckCircle2 className="h-4 w-4" /> Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDecisionOpen({ open: true, mode: 'reject' })}
            >
              <XCircle className="h-4 w-4" /> Reject
            </Button>
          </>
        )}
        {loan.status === 'APPROVED' && canApprove && (
          <Button size="sm" onClick={() => void disburse()} disabled={busy}>
            <PlayCircle className="h-4 w-4" /> Disburse & generate schedule
          </Button>
        )}
        {loan.status === 'REQUESTED' && isMine && (
          <Button size="sm" variant="outline" onClick={() => void cancel()}>
            Cancel request
          </Button>
        )}
        {(loan.status === 'REQUESTED' || loan.status === 'REJECTED' || loan.status === 'CANCELLED') &&
          canApprove && (
            <Button size="sm" variant="outline" onClick={() => void deleteLoan()}>
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          )}
      </div>

      {installments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Installment schedule</CardTitle>
            <CardDescription>
              {stats.paidCount} paid · {stats.pendingCount} pending · {stats.total} total
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2">#</th>
                    <th className="text-left px-4 py-2">Due</th>
                    <th className="text-right px-4 py-2">Amount</th>
                    <th className="text-right px-4 py-2">Principal</th>
                    <th className="text-right px-4 py-2">Interest</th>
                    <th className="text-left px-4 py-2">Status</th>
                    <th className="text-left px-4 py-2">Paid on</th>
                    <th className="text-right px-4 py-2 print:hidden">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {installments.map((i) => (
                    <tr key={i.id} className="border-t">
                      <td className="px-4 py-2 font-mono">{i.installment_no}</td>
                      <td className="px-4 py-2">{i.due_date}</td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {Number(i.amount).toLocaleString()}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                        {Number(i.principal_portion).toLocaleString()}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                        {Number(i.interest_portion).toLocaleString()}
                      </td>
                      <td className="px-4 py-2">
                        <Badge variant={installmentVariant(i.status)}>{i.status}</Badge>
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">
                        {i.paid_at ? new Date(i.paid_at).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-4 py-2 text-right print:hidden">
                        {i.status === 'PENDING' && canUpdate && (
                          <div className="flex justify-end gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setMarkOpen(i)
                                setPaidAmount(Number(i.amount))
                                setPaidDate(new Date().toISOString().slice(0, 10))
                              }}
                            >
                              Mark paid
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => void waiveInstallment(i)}>
                              Waive
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t bg-muted/20">
                  <tr>
                    <td colSpan={2} className="px-4 py-2 font-medium text-right">
                      Totals
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums font-medium">
                      {installments.reduce((s, i) => s + Number(i.amount), 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {installments.reduce((s, i) => s + Number(i.principal_portion), 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {installments.reduce((s, i) => s + Number(i.interest_portion), 0).toLocaleString()}
                    </td>
                    <td colSpan={3}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {loan.status === 'CLOSED' && (
        <div className="rounded-lg border bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200 px-4 py-3 text-sm flex items-center gap-2">
          <Lock className="h-4 w-4" /> Loan fully repaid on{' '}
          {loan.closed_at ? new Date(loan.closed_at).toLocaleDateString() : '—'}.
        </div>
      )}

      {/* Approve/reject dialog */}
      <Dialog
        open={decisionOpen.open}
        onOpenChange={(open) => setDecisionOpen({ open, mode: decisionOpen.mode })}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{decisionOpen.mode === 'approve' ? 'Approve loan' : 'Reject loan'}</DialogTitle>
            <DialogDescription>
              {decisionOpen.mode === 'approve'
                ? 'Approval will activate the loan on the employee account and create the monthly installment schedule.'
                : 'Please share a brief reason. The employee can see this note.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Note {decisionOpen.mode === 'reject' && <span className="text-destructive">*</span>}</Label>
            <Textarea
              rows={3}
              value={decisionNote}
              onChange={(e) => setDecisionNote(e.target.value)}
              placeholder={decisionOpen.mode === 'approve' ? 'Optional comment for the employee' : 'Reason for rejection…'}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDecisionOpen({ open: false, mode: decisionOpen.mode })}>
              Cancel
            </Button>
            <Button
              onClick={() => void decide(decisionOpen.mode === 'approve', decisionNote)}
              disabled={busy || (decisionOpen.mode === 'reject' && decisionNote.trim().length === 0)}
              variant={decisionOpen.mode === 'reject' ? 'destructive' : 'default'}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {decisionOpen.mode === 'approve' ? 'Approve' : 'Reject'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mark paid dialog */}
      <Dialog open={!!markOpen} onOpenChange={(open) => !open && setMarkOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark installment paid</DialogTitle>
            <DialogDescription>
              Confirm the amount and date received for installment #{markOpen?.installment_no}.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Amount (PKR)</Label>
              <Input
                type="number"
                min={0}
                value={paidAmount}
                onChange={(e) => setPaidAmount(+e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Paid on</Label>
              <Input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMarkOpen(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => markOpen && void markInstallmentPaid(markOpen, paidAmount, paidDate)}
              disabled={busy || paidAmount <= 0}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium">{children}</div>
    </div>
  )
}
