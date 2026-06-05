import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  RefreshCw,
  Loader2,
  Timer,
  Send,
  CheckCircle2,
  XCircle,
  Clock,
  Settings2,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { writeAuditLog } from '@/lib/audit'
import { PageHeader } from '@/components/master/PageHeader'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
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
import { computeOtPayAmount, formatPkr } from '@/lib/overtimePay'
import { defaultMultiplierForType } from '@/lib/overtimeTypes'

type OT = {
  id: string
  ot_no: string
  employee_id: string
  ot_date: string
  start_time: string | null
  end_time: string | null
  planned_hours: number
  ot_type: string
  rate_multiplier: number
  hourly_rate: number | null
  amount: number | null
  reason: string
  source: string | null
  status: string
  approver_id: string | null
  employees?: { full_name: string; employee_code: string; overtime_eligible?: boolean }
  approver?: { full_name: string | null; email: string } | null
}

type UserOption = { id: string; email: string; full_name: string | null }

type Tab = 'queue' | 'mine'

export function OvertimeApprovalPage() {
  const { appUser, hasPermission } = useAuth()
  const canRoute = hasPermission('overtime.approve') || hasPermission('overtime.config')
  const [tab, setTab] = useState<Tab>(canRoute ? 'queue' : 'mine')
  const [rows, setRows] = useState<OT[]>([])
  const [users, setUsers] = useState<UserOption[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [picker, setPicker] = useState<Record<string, string>>({})
  const [decisionFor, setDecisionFor] = useState<{ ot: OT; approve: boolean } | null>(null)
  const [decisionNote, setDecisionNote] = useState('')
  const [decisionBusy, setDecisionBusy] = useState(false)
  const [payById, setPayById] = useState<Record<string, { amount: number; hourly: number }>>({})
  const [syncingPay, setSyncingPay] = useState(false)

  async function loadUsers() {
    const { data, error } = await supabase
      .from('users')
      .select('id, email, full_name')
      .eq('status', 'Active')
      .order('full_name')
    if (error) toast.error('Failed to load users', { description: error.message })
    else setUsers((data ?? []) as UserOption[])
  }

  async function load() {
    setLoading(true)
    let q = supabase
      .from('overtime_requests')
      .select(
        'id, ot_no, employee_id, ot_date, start_time, end_time, planned_hours, ot_type, rate_multiplier, hourly_rate, amount, reason, source, status, approver_id, employees(full_name, employee_code, overtime_eligible), approver:users!overtime_requests_approver_id_fkey(full_name, email)'
      )
      .eq('status', 'PENDING')
      .order('ot_date', { ascending: false })
      .limit(300)

    if (tab === 'queue') {
      q = q.eq('source', 'attendance')
    } else if (appUser?.id) {
      q = q.eq('approver_id', appUser.id)
    }

    const { data, error } = await q
    if (error) {
      toast.error('Failed to load overtime', { description: error.message })
      setPayById({})
    } else {
      const mapped = (data ?? [])
        .map((r: Record<string, unknown>) => ({
          ...(r as object),
          employees: Array.isArray(r.employees) ? (r.employees as unknown[])[0] : r.employees,
          approver: Array.isArray(r.approver) ? (r.approver as unknown[])[0] : r.approver,
        }))
        .filter((r) => {
          const emp = r.employees as { overtime_eligible?: boolean } | null | undefined
          return emp?.overtime_eligible !== false
        }) as OT[]
      setRows(mapped)
      const next: Record<string, string> = {}
      for (const row of mapped) {
        if (row.approver_id) next[row.id] = row.approver_id
      }
      setPicker((prev) => ({ ...next, ...prev }))
      void syncPayAmounts(mapped)
    }
    setLoading(false)
  }

  async function syncPayAmounts(list: OT[]) {
    if (list.length === 0) {
      setPayById({})
      return
    }
    setSyncingPay(true)
    const next: Record<string, { amount: number; hourly: number }> = {}
    const rowPatches: Partial<OT>[] = []
    for (const ot of list) {
      // Attendance weekday OT should be NORMAL (×1.0), not NIGHT
      const otType =
        ot.source === 'attendance' && ot.ot_type === 'NIGHT' ? 'NORMAL' : ot.ot_type
      const mult =
        ot.source === 'attendance' && ot.ot_type === 'NIGHT'
          ? 1.0
          : Number(ot.rate_multiplier) > 0
            ? Number(ot.rate_multiplier)
            : defaultMultiplierForType(otType)
      const pay = await computeOtPayAmount(
        supabase,
        ot.employee_id,
        ot.ot_date,
        Number(ot.planned_hours),
        mult
      )
      if (!pay.data || pay.data.request_amount <= 0) continue
      next[ot.id] = { amount: pay.data.request_amount, hourly: pay.data.hourly_rate }

      const stored = Number(ot.amount ?? 0)
      const storedHourly = Number(ot.hourly_rate ?? 0)
      const fixType = ot.source === 'attendance' && ot.ot_type === 'NIGHT'
      if (
        fixType ||
        Math.abs(stored - pay.data.request_amount) > 0.5 ||
        Math.abs(storedHourly - pay.data.hourly_rate) > 0.01
      ) {
        await supabase
          .from('overtime_requests')
          .update({
            ...(fixType ? { ot_type: 'NORMAL', rate_multiplier: 1.0 } : {}),
            hourly_rate: pay.data.hourly_rate,
            amount: pay.data.request_amount,
          })
          .eq('id', ot.id)
          .eq('status', 'PENDING')
        rowPatches.push({
          id: ot.id,
          ...(fixType ? { ot_type: 'NORMAL', rate_multiplier: 1.0 } : {}),
          hourly_rate: pay.data.hourly_rate,
          amount: pay.data.request_amount,
        })
      }
    }
    if (rowPatches.length > 0) {
      setRows((prev) =>
        prev.map((r) => {
          const p = rowPatches.find((x) => x.id === r.id)
          return p ? { ...r, ...p } : r
        })
      )
    }
    setPayById(next)
    setSyncingPay(false)
  }

  useEffect(() => {
    void loadUsers()
  }, [])

  useEffect(() => {
    void load()
  }, [tab, appUser?.id])

  const queueStats = useMemo(() => {
    const unassigned = rows.filter((r) => !r.approver_id).length
    const assigned = rows.filter((r) => r.approver_id).length
    const hours = rows.reduce((s, r) => s + Number(r.planned_hours), 0)
    return { unassigned, assigned, hours, total: rows.length }
  }, [rows])

  async function sendForApproval(ot: OT) {
    const approverId = picker[ot.id]
    if (!approverId) {
      toast.error('Select a user to send for approval')
      return
    }
    if (!appUser) return
    setBusyId(ot.id)
    const { error } = await supabase
      .from('overtime_requests')
      .update({
        approver_id: approverId,
        requested_by: appUser.id,
      })
      .eq('id', ot.id)
      .eq('status', 'PENDING')
    setBusyId(null)
    if (error) {
      toast.error('Send failed', { description: error.message })
      return
    }
    await writeAuditLog({
      action: 'UPDATE',
      entityType: 'overtime',
      entityId: ot.id,
      after: { approver_id: approverId, action: 'sent_for_approval' },
    })
    const name = users.find((u) => u.id === approverId)?.full_name ?? 'approver'
    toast.success(`Sent to ${name} for approval`)
    void load()
  }

  async function decide() {
    if (!decisionFor || !appUser) return
    setDecisionBusy(true)
    const { ot, approve } = decisionFor
    const next = approve ? 'APPROVED' : 'REJECTED'

    const mult =
      Number(ot.rate_multiplier) > 0
        ? Number(ot.rate_multiplier)
        : defaultMultiplierForType(ot.ot_type)
    const cached = payById[ot.id]
    let hourly = cached?.hourly ?? Number(ot.hourly_rate ?? 0)
    let amount = cached?.amount ?? Number(ot.amount ?? 0)
    if (approve && (hourly <= 0 || amount <= 0)) {
      const pay = await computeOtPayAmount(
        supabase,
        ot.employee_id,
        ot.ot_date,
        Number(ot.planned_hours),
        mult
      )
      if (pay.data) {
        hourly = pay.data.hourly_rate
        amount = pay.data.request_amount
      }
    }

    const { error } = await supabase
      .from('overtime_requests')
      .update({
        status: next,
        approved_by: appUser.id,
        approved_at: new Date().toISOString(),
        decision_note: decisionNote.trim() || null,
        actual_hours: approve ? ot.planned_hours : null,
        hourly_rate: approve && hourly > 0 ? hourly : ot.hourly_rate,
        amount: approve && amount > 0 ? amount : approve ? null : ot.amount,
      })
      .eq('id', ot.id)

    setDecisionBusy(false)
    if (error) {
      toast.error('Decision failed', { description: error.message })
      return
    }
    await writeAuditLog({
      action: 'UPDATE',
      entityType: 'overtime',
      entityId: ot.id,
      after: { status: next, decision_note: decisionNote },
    })
    toast.success(approve ? 'Overtime approved' : 'Overtime rejected')
    setDecisionFor(null)
    setDecisionNote('')
    void load()
  }

  const tabs: { id: Tab; label: string; visible: boolean }[] = [
    { id: 'queue', label: 'Attendance overtime', visible: canRoute },
    { id: 'mine', label: 'Sent to me for approval', visible: true },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Over Time Approval"
        description="Pay = basic ÷ (month days × 8 h) × OT hours × multiplier. Assign an approver, then approve or reject."
        actions={
          <>
            {canRoute && (
              <Button variant="outline" size="sm" asChild>
                <Link to="/overtime/edit-type">
                  <Settings2 className="h-4 w-4" /> Change OT type
                </Link>
              </Button>
            )}
            <Button variant="outline" size="sm" disabled={loading || syncingPay} onClick={() => void load()}>
              {syncingPay ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </>
        }
      />

      {canRoute && tab === 'queue' && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Card>
            <CardContent className="pt-5">
              <div className="text-xs text-muted-foreground">Pending from attendance</div>
              <div className="text-2xl font-semibold tabular-nums">{queueStats.total}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <div className="text-xs text-muted-foreground">Awaiting approver pick</div>
              <div className="text-2xl font-semibold tabular-nums">{queueStats.unassigned}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <div className="text-xs text-muted-foreground">Total pending hours</div>
              <div className="text-2xl font-semibold tabular-nums">{queueStats.hours.toFixed(1)} h</div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-b">
        {tabs
          .filter((t) => t.visible)
          .map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={
                'px-4 py-2 text-sm border-b-2 -mb-px transition-colors ' +
                (tab === t.id
                  ? 'border-primary text-primary font-medium'
                  : 'border-transparent text-muted-foreground hover:text-foreground')
              }
            >
              {t.label}
            </button>
          ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {tab === 'queue' ? 'Attendance overtime queue' : 'My approval inbox'}
          </CardTitle>
          <CardDescription>
            {tab === 'queue'
              ? 'Amounts refresh on load using basic ÷ (month days × 8) × hours × multiplier. Weekday attendance OT uses Normal (×1.0).'
              : 'Overtime requests assigned to you. Approve to confirm pay amount.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-12 grid place-items-center">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : rows.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">
              <Timer className="h-8 w-8 mx-auto mb-3 opacity-50" />
              {tab === 'queue'
                ? 'No pending attendance overtime. Ensure attendance sync / agent is running.'
                : 'Nothing sent to you for approval yet.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2">Employee</th>
                    <th className="text-left px-4 py-2">Date</th>
                    <th className="text-left px-4 py-2">Time</th>
                    <th className="text-right px-4 py-2">Hours</th>
                    <th className="text-right px-4 py-2">Amount</th>
                    <th className="text-left px-4 py-2">Type</th>
                    {tab === 'queue' && (
                      <th className="text-left px-4 py-2 min-w-[200px]">Send for approval to</th>
                    )}
                    {tab === 'mine' && <th className="text-left px-4 py-2">Status</th>}
                    <th className="text-right px-4 py-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-t hover:bg-muted/20">
                      <td className="px-4 py-3">
                        <div className="font-medium">{r.employees?.full_name}</div>
                        <div className="text-xs text-muted-foreground font-mono">
                          {r.employees?.employee_code} · {r.ot_no}
                        </div>
                      </td>
                      <td className="px-4 py-3">{r.ot_date}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {r.start_time && r.end_time ? `${r.start_time} → ${r.end_time}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium">
                        {Number(r.planned_hours).toFixed(2)} h
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {payById[r.id]?.amount != null
                          ? formatPkr(payById[r.id].amount)
                          : r.amount != null
                            ? formatPkr(Number(r.amount))
                            : syncingPay
                              ? '…'
                              : '—'}
                        {payById[r.id] && r.amount != null &&
                          Math.abs(Number(r.amount) - payById[r.id].amount) > 0.5 && (
                            <div className="text-[10px] text-muted-foreground line-through">
                              was {formatPkr(Number(r.amount))}
                            </div>
                          )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="outline">{r.ot_type}</Badge>
                      </td>
                      {tab === 'queue' && (
                        <td className="px-4 py-3">
                          <Select
                            value={picker[r.id] ?? ''}
                            onChange={(e) => setPicker({ ...picker, [r.id]: e.target.value })}
                          >
                            <option value="">Select user…</option>
                            {users.map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.full_name ?? u.email}
                              </option>
                            ))}
                          </Select>
                          {r.approver && (
                            <p className="text-xs text-muted-foreground mt-1">
                              Sent to: {r.approver.full_name ?? r.approver.email}
                            </p>
                          )}
                        </td>
                      )}
                      {tab === 'mine' && (
                        <td className="px-4 py-3">
                          <Badge variant="warm" className="gap-1">
                            <Clock className="h-3 w-3" /> PENDING
                          </Badge>
                        </td>
                      )}
                      <td className="px-4 py-3 text-right">
                        {tab === 'queue' && canRoute && (
                          <Button
                            size="sm"
                            disabled={busyId === r.id || !picker[r.id]}
                            onClick={() => void sendForApproval(r)}
                          >
                            {busyId === r.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Send className="h-4 w-4" />
                            )}
                            Send
                          </Button>
                        )}
                        {tab === 'mine' && (
                          <div className="flex justify-end gap-1">
                            <Button
                              size="sm"
                              onClick={() => setDecisionFor({ ot: r, approve: true })}
                            >
                              <CheckCircle2 className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setDecisionFor({ ot: r, approve: false })}
                            >
                              <XCircle className="h-4 w-4" />
                            </Button>
                          </div>
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

      <Dialog open={!!decisionFor} onOpenChange={(o) => !o && setDecisionFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{decisionFor?.approve ? 'Approve overtime' : 'Reject overtime'}</DialogTitle>
            <DialogDescription>
              {decisionFor?.ot.employees?.full_name} · {decisionFor?.ot.ot_date} ·{' '}
              {Number(decisionFor?.ot.planned_hours ?? 0).toFixed(2)} h
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Note {decisionFor?.approve ? '' : <span className="text-destructive">*</span>}</Label>
            <Textarea
              rows={3}
              value={decisionNote}
              onChange={(e) => setDecisionNote(e.target.value)}
              placeholder={decisionFor?.approve ? 'Optional comment' : 'Reason for rejection…'}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDecisionFor(null)}>
              Cancel
            </Button>
            <Button
              variant={decisionFor?.approve ? 'default' : 'destructive'}
              disabled={decisionBusy || (!decisionFor?.approve && !decisionNote.trim())}
              onClick={() => void decide()}
            >
              {decisionBusy && <Loader2 className="h-4 w-4 animate-spin" />}
              {decisionFor?.approve ? 'Approve' : 'Reject'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
