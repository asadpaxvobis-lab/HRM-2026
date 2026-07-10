import { useEffect, useMemo, useState } from 'react'
import { Plus, RefreshCw, Loader2, CalendarDays, Check, X, Save, Inbox } from 'lucide-react'
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
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { avatarColorFor, initialsFromName } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from 'sonner'

type LeaveType = {
  id: string
  code: string
  name: string
  color: string
  is_paid: boolean
  requires_attachment: boolean
  allow_half_day: boolean
  applies_to_gender: string | null
}

type Employee = { id: string; employee_code: string; full_name: string; gender: string | null }

type Application = {
  id: string
  employee_id: string
  leave_type_id: string
  start_date: string
  end_date: string
  half_day: boolean
  half_day_part: string | null
  total_days: number
  reason: string
  status: 'Pending' | 'Approved' | 'Rejected' | 'Cancelled'
  decision_note: string | null
  decided_at: string | null
  created_at: string
  employees?: { employee_code: string; full_name: string } | null
  leave_types?: { code: string; name: string; color: string } | null
}

type Balance = { leave_type_id: string; opening: number; granted: number; consumed: number; carry_forward: number }

const today = () => new Date().toISOString().slice(0, 10)
const thisYear = () => new Date().getFullYear()

function diffDaysInclusive(a: string, b: string): number {
  const start = new Date(a + 'T00:00:00')
  const end = new Date(b + 'T00:00:00')
  const ms = end.getTime() - start.getTime()
  return Math.floor(ms / 86_400_000) + 1
}

const statusVariant = (s: string): 'warm' | 'outline' | 'secondary' => {
  if (s === 'Pending') return 'warm'
  if (s === 'Approved') return 'outline'
  return 'secondary'
}

const TABS = ['Apply', 'My requests', 'All requests'] as const

export function LeavePage() {
  const { appUser, hasPermission } = useAuth()
  const canApprove = hasPermission('leave.approve')
  const canApply = hasPermission('leave.apply')
  const [tab, setTab] = useState<typeof TABS[number]>(canApply ? 'Apply' : 'All requests')
  const [types, setTypes] = useState<LeaveType[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [me, setMe] = useState<Employee | null>(null)
  const [balances, setBalances] = useState<Balance[]>([])
  const [rows, setRows] = useState<Application[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({
    employee_id: '',
    leave_type_id: '',
    start_date: today(),
    end_date: today(),
    half_day: false,
    half_day_part: 'first' as 'first' | 'second',
    reason: '',
  })
  const [decision, setDecision] = useState<{ id: string; status: 'Approved' | 'Rejected'; note: string } | null>(null)
  const [statusFilter, setStatusFilter] = useState<'Pending' | 'Approved' | 'Rejected' | 'Cancelled' | 'All'>('Pending')

  async function load() {
    if (!appUser) return
    setLoading(true)
    const [t, e, a] = await Promise.all([
      supabase.from('leave_types').select('*').eq('is_active', true).order('name'),
      supabase
        .from('employees')
        .select('id, employee_code, full_name, gender')
        .eq('is_active', true)
        .order('full_name'),
      supabase
        .from('leave_applications')
        .select(
          'id, employee_id, leave_type_id, start_date, end_date, half_day, half_day_part, total_days, reason, status, decision_note, decided_at, created_at, employees(employee_code, full_name), leave_types(code, name, color)'
        )
        .order('created_at', { ascending: false })
        .limit(500),
    ])
    setTypes((t.data ?? []) as LeaveType[])
    setEmployees((e.data ?? []) as Employee[])
    const meRow = (e.data ?? []).find((x) => x.id === appUser.employee_id) ?? null
    setMe(meRow as Employee | null)
    const mapped = (a.data ?? []).map((r: Record<string, unknown>) => {
      const emp = r.employees
      const lt = r.leave_types
      return {
        ...r,
        employees: Array.isArray(emp) ? emp[0] : emp,
        leave_types: Array.isArray(lt) ? lt[0] : lt,
      } as Application
    })
    setRows(mapped)
    if (meRow) {
      const { data: b } = await supabase
        .from('leave_balances')
        .select('leave_type_id, opening, granted, consumed, carry_forward')
        .eq('employee_id', meRow.id)
        .eq('year', thisYear())
      setBalances((b ?? []) as Balance[])
    }
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [appUser?.id])

  useEffect(() => {
    if (me && !form.employee_id) setForm((f) => ({ ...f, employee_id: me.id }))
  }, [me])

  const myRequests = useMemo(() => rows.filter((r) => r.employee_id === appUser?.employee_id), [rows, appUser?.employee_id])
  const allFiltered = useMemo(() => {
    if (statusFilter === 'All') return rows
    return rows.filter((r) => r.status === statusFilter)
  }, [rows, statusFilter])

  const balanceFor = (typeId: string): { remaining: number; granted: number; consumed: number } => {
    const b = balances.find((x) => x.leave_type_id === typeId)
    if (!b) return { remaining: 0, granted: 0, consumed: 0 }
    return {
      remaining: +b.opening + +b.granted + +b.carry_forward - +b.consumed,
      granted: +b.granted,
      consumed: +b.consumed,
    }
  }

  const totalDays = useMemo(() => {
    if (!form.start_date || !form.end_date) return 0
    const d = diffDaysInclusive(form.start_date, form.end_date)
    if (d < 1) return 0
    if (form.half_day && d === 1) return 0.5
    return d
  }, [form.start_date, form.end_date, form.half_day])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!appUser) return
    if (!form.employee_id || !form.leave_type_id) {
      toast.error('Pick employee and leave type')
      return
    }
    if (!form.reason.trim()) {
      toast.error('Reason is required')
      return
    }
    if (totalDays <= 0) {
      toast.error('Pick a valid date range')
      return
    }
    setBusy(true)
    const payload = {
      company_id: appUser.company_id,
      employee_id: form.employee_id,
      leave_type_id: form.leave_type_id,
      start_date: form.start_date,
      end_date: form.end_date,
      half_day: form.half_day && totalDays === 0.5,
      half_day_part: form.half_day && totalDays === 0.5 ? form.half_day_part : null,
      total_days: totalDays,
      reason: form.reason.trim(),
      requested_by: appUser.id,
    }
    const { data, error } = await supabase.from('leave_applications').insert(payload).select('id').single()
    setBusy(false)
    if (error) {
      toast.error('Submit failed', { description: error.message })
      return
    }
    await writeAuditLog({ action: 'CREATE', entityType: 'leave_application', entityId: data?.id, after: payload })
    toast.success('Leave request submitted')
    setForm((f) => ({ ...f, reason: '', start_date: today(), end_date: today() }))
    setTab(form.employee_id === appUser.employee_id ? 'My requests' : 'All requests')
    void load()
  }

  const decide = async () => {
    if (!decision || !appUser) return
    setBusy(true)
    const target = rows.find((r) => r.id === decision.id)
    const { error } = await supabase
      .from('leave_applications')
      .update({
        status: decision.status,
        decision_note: decision.note.trim() || null,
        approver_id: appUser.id,
        decided_at: new Date().toISOString(),
      })
      .eq('id', decision.id)
    if (error) {
      setBusy(false)
      toast.error('Decision failed', { description: error.message })
      return
    }

    if (decision.status === 'Approved' && target) {
      const { data: bal } = await supabase
        .from('leave_balances')
        .select('id, consumed')
        .eq('employee_id', target.employee_id)
        .eq('leave_type_id', target.leave_type_id)
        .eq('year', new Date(target.start_date).getFullYear())
        .maybeSingle()
      if (bal) {
        await supabase
          .from('leave_balances')
          .update({ consumed: +bal.consumed + +target.total_days })
          .eq('id', bal.id)
      } else {
        await supabase.from('leave_balances').insert({
          employee_id: target.employee_id,
          leave_type_id: target.leave_type_id,
          year: new Date(target.start_date).getFullYear(),
          opening: 0,
          granted: 0,
          consumed: target.total_days,
          carry_forward: 0,
        })
      }
    }

    await writeAuditLog({
      action: 'UPDATE',
      entityType: 'leave_application',
      entityId: decision.id,
      after: { status: decision.status, note: decision.note },
    })
    setBusy(false)
    setDecision(null)
    toast.success(`Leave ${decision.status.toLowerCase()}`)
    void load()
  }

  const cancelOwn = async (r: Application) => {
    if (!confirm('Cancel this request?')) return
    const { error } = await supabase
      .from('leave_applications')
      .update({ status: 'Cancelled', decided_at: new Date().toISOString() })
      .eq('id', r.id)
    if (error) {
      toast.error('Cancel failed', { description: error.message })
      return
    }
    await writeAuditLog({ action: 'UPDATE', entityType: 'leave_application', entityId: r.id, after: { status: 'Cancelled' } })
    toast.success('Request cancelled')
    void load()
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leave"
        description="Apply for leave, track your requests, and approve team members' applications."
        actions={
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        }
      />

      <div className="flex gap-1 border-b overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
              tab === t ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Apply' && (
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">New leave request</CardTitle>
                <CardDescription>Approved requests automatically deduct from the balance.</CardDescription>
              </CardHeader>
              <CardContent>
                <form className="space-y-4" onSubmit={submit}>
                  <HasPermission perm="leave.approve">
                    <div className="space-y-2">
                      <Label>Employee</Label>
                      <EmployeeSearchSelect
                        employees={employees}
                        value={form.employee_id}
                        onChange={(employeeId) => setForm({ ...form, employee_id: employeeId })}
                      />
                    </div>
                  </HasPermission>
                  <div className="space-y-2">
                    <Label>Leave type</Label>
                    <Select required value={form.leave_type_id} onChange={(e) => setForm({ ...form, leave_type_id: e.target.value })}>
                      <option value="">Select leave type</option>
                      {types.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({t.code})
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Start date</Label>
                      <Input type="date" required value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label>End date</Label>
                      <Input type="date" required value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
                    </div>
                  </div>
                  {diffDaysInclusive(form.start_date, form.end_date) === 1 && (
                    <div className="flex flex-wrap gap-3 items-center">
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox checked={form.half_day} onCheckedChange={(v) => setForm({ ...form, half_day: !!v })} />
                        Half day
                      </label>
                      {form.half_day && (
                        <Select value={form.half_day_part} onChange={(e) => setForm({ ...form, half_day_part: e.target.value as 'first' | 'second' })} className="w-40">
                          <option value="first">First half</option>
                          <option value="second">Second half</option>
                        </Select>
                      )}
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label>Reason</Label>
                    <Textarea required rows={3} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-muted/40 p-3 text-sm">
                    <span>Total leave days requested</span>
                    <span className="font-semibold tabular-nums">{totalDays}</span>
                  </div>
                  <div className="flex justify-end">
                    <Button type="submit" disabled={busy}>
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      Submit request
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">My balances · {thisYear()}</CardTitle>
                <CardDescription>{me ? me.full_name : 'No employee record linked'}</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {!me ? (
                  <div className="p-6 text-sm text-muted-foreground">
                    Your user is not linked to an employee record yet, so balances are not visible.
                  </div>
                ) : balances.length === 0 ? (
                  <div className="p-6 text-sm text-muted-foreground">No balances granted for {thisYear()} yet.</div>
                ) : (
                  <div className="divide-y">
                    {types
                      .filter((t) => !t.applies_to_gender || !me.gender || t.applies_to_gender === me.gender)
                      .map((t) => {
                        const b = balanceFor(t.id)
                        return (
                          <div key={t.id} className="flex items-center gap-3 px-6 py-3">
                            <span className="inline-block h-2 w-2 rounded-full" style={{ background: t.color }} />
                            <div className="flex-1">
                              <div className="text-sm font-medium">{t.name}</div>
                              <div className="text-[11px] text-muted-foreground">
                                Granted {b.granted} · Used {b.consumed}
                              </div>
                            </div>
                            <Badge variant={b.remaining > 0 ? 'warm' : 'outline'} className="tabular-nums">
                              {b.remaining} left
                            </Badge>
                          </div>
                        )
                      })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {tab === 'My requests' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">My requests</CardTitle>
            <CardDescription>{myRequests.length} total</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-12 grid place-items-center"><Loader2 className="h-5 w-5 animate-spin" /></div>
            ) : myRequests.length === 0 ? (
              <div className="p-16 text-center text-sm text-muted-foreground">
                <CalendarDays className="h-8 w-8 mx-auto mb-3 opacity-50" />
                You haven't requested any leave.
              </div>
            ) : (
              <RequestList items={myRequests} canApprove={false} onCancel={cancelOwn} myUserId={appUser?.employee_id ?? null} />
            )}
          </CardContent>
        </Card>
      )}

      {tab === 'All requests' && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-3">
              <CardTitle className="text-base">All requests</CardTitle>
              <CardDescription>{allFiltered.length} shown</CardDescription>
              <div className="ml-auto">
                <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
                  {(['Pending', 'Approved', 'Rejected', 'Cancelled', 'All'] as const).map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-12 grid place-items-center"><Loader2 className="h-5 w-5 animate-spin" /></div>
            ) : allFiltered.length === 0 ? (
              <div className="p-16 text-center text-sm text-muted-foreground">
                <Inbox className="h-8 w-8 mx-auto mb-3 opacity-50" />
                No requests in this view.
              </div>
            ) : (
              <RequestList
                items={allFiltered}
                canApprove={canApprove}
                onApprove={(id) => setDecision({ id, status: 'Approved', note: '' })}
                onReject={(id) => setDecision({ id, status: 'Rejected', note: '' })}
                onCancel={cancelOwn}
                myUserId={appUser?.employee_id ?? null}
              />
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={!!decision} onOpenChange={(v) => !v && setDecision(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{decision?.status === 'Approved' ? 'Approve leave' : 'Reject leave'}</DialogTitle>
            <DialogDescription>
              {decision?.status === 'Approved'
                ? 'Approving deducts the requested days from the employee balance.'
                : 'Rejecting closes the request without changing any balance.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Decision note (optional)</Label>
            <Textarea
              rows={3}
              value={decision?.note ?? ''}
              onChange={(e) => decision && setDecision({ ...decision, note: e.target.value })}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDecision(null)}>Cancel</Button>
            <Button onClick={decide} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : decision?.status === 'Approved' ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
              Confirm {decision?.status?.toLowerCase()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function RequestList({
  items,
  canApprove,
  onApprove,
  onReject,
  onCancel,
  myUserId,
}: {
  items: Application[]
  canApprove: boolean
  onApprove?: (id: string) => void
  onReject?: (id: string) => void
  onCancel?: (r: Application) => void
  myUserId: string | null
}) {
  return (
    <div className="divide-y">
      {items.map((r) => (
        <div key={r.id} className="flex flex-wrap items-start gap-4 px-6 py-4">
          <Avatar className="h-9 w-9">
            <AvatarFallback className={avatarColorFor(r.employees?.employee_code ?? '')}>
              {initialsFromName(r.employees?.full_name ?? '?')}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-[260px]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{r.employees?.full_name ?? '—'}</span>
              <span
                className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider"
                style={{ background: (r.leave_types?.color ?? '#999') + '33', color: r.leave_types?.color ?? undefined }}
              >
                {r.leave_types?.code}
              </span>
            </div>
            <div className="text-xs text-muted-foreground tabular-nums">
              {r.start_date} → {r.end_date} · {r.total_days} day(s)
              {r.half_day && r.half_day_part ? ` · ${r.half_day_part} half` : ''}
            </div>
            <div className="mt-2 text-sm">{r.reason}</div>
            {r.decision_note && (
              <div className="mt-1 text-xs italic text-muted-foreground">Decision: {r.decision_note}</div>
            )}
          </div>
          <div className="flex flex-col items-end gap-2">
            <Badge variant={statusVariant(r.status)}>{r.status}</Badge>
            <span className="text-xs text-muted-foreground tabular-nums">{new Date(r.created_at).toLocaleString('en-PK')}</span>
            <div className="flex gap-1">
              {r.status === 'Pending' && canApprove && onApprove && onReject && (
                <>
                  <Button size="sm" variant="outline" onClick={() => onApprove(r.id)}>
                    <Check className="h-4 w-4" /> Approve
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => onReject(r.id)}>
                    <X className="h-4 w-4" /> Reject
                  </Button>
                </>
              )}
              {r.status === 'Pending' && r.employee_id === myUserId && onCancel && (
                <Button size="sm" variant="outline" onClick={() => onCancel(r)}>Cancel</Button>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
