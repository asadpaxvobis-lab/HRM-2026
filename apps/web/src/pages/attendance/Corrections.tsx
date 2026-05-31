import { useEffect, useMemo, useState } from 'react'
import { Plus, RefreshCw, Loader2, FileQuestion, Check, X, Save } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { writeAuditLog } from '@/lib/audit'
import { PageHeader } from '@/components/master/PageHeader'
import { HasPermission } from '@/components/HasPermission'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
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
import { localDatetimeInputToIso } from '@/lib/attendance'

type Correction = {
  id: string
  employee_id: string
  attendance_date: string
  reason: string
  proposed_in: string | null
  proposed_out: string | null
  status: 'Pending' | 'Approved' | 'Rejected'
  decision_note: string | null
  decided_at: string | null
  created_at: string
  employees?: { employee_code: string; full_name: string } | null
}

type Employee = { id: string; employee_code: string; full_name: string }

const STATUS_FILTERS = ['Pending', 'Approved', 'Rejected', 'All'] as const

const statusVariant = (s: string): 'warm' | 'outline' | 'secondary' => {
  if (s === 'Pending') return 'warm'
  if (s === 'Approved') return 'outline'
  return 'secondary'
}

const fmtDateTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-PK') : '—')

function localDateTimeInputValue(d?: Date) {
  const x = d ?? new Date()
  const local = new Date(x.getTime() - x.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

export function CorrectionsPage() {
  const { appUser, hasPermission } = useAuth()
  const canApprove = hasPermission('attendance.approve')
  const canRequest = true
  const [rows, setRows] = useState<Correction[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<typeof STATUS_FILTERS[number]>('Pending')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({
    employee_id: '',
    attendance_date: new Date().toISOString().slice(0, 10),
    proposed_in: '',
    proposed_out: '',
    reason: '',
  })
  const [decision, setDecision] = useState<{ id: string; status: 'Approved' | 'Rejected'; note: string } | null>(null)

  async function load() {
    setLoading(true)
    const [c, e] = await Promise.all([
      supabase
        .from('attendance_corrections')
        .select(
          'id, employee_id, attendance_date, reason, proposed_in, proposed_out, status, decision_note, decided_at, created_at, employees(employee_code, full_name)'
        )
        .order('created_at', { ascending: false })
        .limit(500),
      supabase.from('employees').select('id, employee_code, full_name').eq('is_active', true).order('full_name'),
    ])
    if (c.error) toast.error('Failed to load corrections', { description: c.error.message })
    else {
      const mapped = (c.data ?? []).map((r: Record<string, unknown>) => {
        const emp = r.employees
        return { ...r, employees: Array.isArray(emp) ? emp[0] : emp } as Correction
      })
      setRows(mapped)
    }
    setEmployees((e.data ?? []) as Employee[])
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  const filtered = useMemo(() => {
    if (statusFilter === 'All') return rows
    return rows.filter((r) => r.status === statusFilter)
  }, [rows, statusFilter])

  const counts = useMemo(() => {
    const acc = { Pending: 0, Approved: 0, Rejected: 0 }
    for (const r of rows) acc[r.status] = (acc[r.status] ?? 0) + 1
    return acc
  }, [rows])

  const openRequest = () => {
    setForm({
      employee_id: '',
      attendance_date: new Date().toISOString().slice(0, 10),
      proposed_in: localDateTimeInputValue(),
      proposed_out: '',
      reason: '',
    })
    setOpen(true)
  }

  const submitRequest = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!appUser) return
    if (!form.employee_id) {
      toast.error('Select an employee')
      return
    }
    if (!form.reason.trim()) {
      toast.error('Reason is required')
      return
    }
    if (!form.proposed_in && !form.proposed_out) {
      toast.error('Provide at least proposed in or out time')
      return
    }
    setBusy(true)
    const payload = {
      employee_id: form.employee_id,
      attendance_date: form.attendance_date,
      reason: form.reason.trim(),
      proposed_in: form.proposed_in ? localDatetimeInputToIso(form.proposed_in) : null,
      proposed_out: form.proposed_out ? localDatetimeInputToIso(form.proposed_out) : null,
      requested_by: appUser.id,
    }
    const { data, error } = await supabase.from('attendance_corrections').insert(payload).select('id').single()
    setBusy(false)
    if (error) {
      toast.error('Submit failed', { description: error.message })
      return
    }
    await writeAuditLog({ action: 'CREATE', entityType: 'attendance_correction', entityId: data?.id, after: payload })
    toast.success('Correction submitted')
    setOpen(false)
    void load()
  }

  const decide = async () => {
    if (!decision || !appUser) return
    setBusy(true)
    const { error } = await supabase.rpc('approve_attendance_correction', {
      p_correction_id: decision.id,
      p_status: decision.status,
      p_decision_note: decision.note.trim() || null,
    })
    if (error) {
      setBusy(false)
      toast.error('Decision failed', { description: error.message })
      return
    }

    await writeAuditLog({
      action: 'UPDATE',
      entityType: 'attendance_correction',
      entityId: decision.id,
      after: { status: decision.status, note: decision.note },
    })
    setBusy(false)
    setDecision(null)
    toast.success(
      decision.status === 'Approved'
        ? 'Correction approved — attendance updated for that day'
        : `Correction ${decision.status.toLowerCase()}`
    )
    void load()
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance corrections"
        description="Request fixes for missed punches; approvers turn approved requests into real punches and re-aggregate the day."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            {canRequest && (
              <Button size="sm" onClick={openRequest}>
                <Plus className="h-4 w-4" /> New correction
              </Button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground uppercase tracking-wider">Pending</div>
          <div className="text-2xl font-semibold tabular-nums">{counts.Pending}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground uppercase tracking-wider">Approved</div>
          <div className="text-2xl font-semibold tabular-nums">{counts.Approved}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground uppercase tracking-wider">Rejected</div>
          <div className="text-2xl font-semibold tabular-nums">{counts.Rejected}</div>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-3">
            <CardTitle className="text-base">Requests</CardTitle>
            <CardDescription>{filtered.length} shown</CardDescription>
            <div className="ml-auto">
              <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof STATUS_FILTERS[number])}>
                {STATUS_FILTERS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-12 grid place-items-center">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-16 text-center text-sm text-muted-foreground">
              <FileQuestion className="h-8 w-8 mx-auto mb-3 opacity-50" />
              No corrections in this view.
            </div>
          ) : (
            <div className="divide-y">
              {filtered.map((r) => (
                <div key={r.id} className="flex flex-wrap items-start gap-4 px-6 py-4">
                  <Avatar className="h-9 w-9">
                    <AvatarFallback className={avatarColorFor(r.employees?.employee_code ?? '')}>
                      {initialsFromName(r.employees?.full_name ?? '?')}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-[240px]">
                    <div className="font-medium">{r.employees?.full_name ?? '—'}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.employees?.employee_code} · for {r.attendance_date}
                    </div>
                    <div className="mt-2 text-sm">{r.reason}</div>
                    <div className="mt-1 text-xs text-muted-foreground space-x-3 tabular-nums">
                      {r.proposed_in && <span>In: {fmtDateTime(r.proposed_in)}</span>}
                      {r.proposed_out && <span>Out: {fmtDateTime(r.proposed_out)}</span>}
                    </div>
                    {r.decision_note && (
                      <div className="mt-2 text-xs italic text-muted-foreground">Decision note: {r.decision_note}</div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <Badge variant={statusVariant(r.status)}>{r.status}</Badge>
                    <span className="text-xs text-muted-foreground tabular-nums">{fmtDateTime(r.created_at)}</span>
                    {r.status === 'Pending' && canApprove && (
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" onClick={() => setDecision({ id: r.id, status: 'Approved', note: '' })}>
                          <Check className="h-4 w-4" /> Approve
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setDecision({ id: r.id, status: 'Rejected', note: '' })}>
                          <X className="h-4 w-4" /> Reject
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New correction request</DialogTitle>
            <DialogDescription>
              Use this when an employee missed a punch. Approved requests insert real punches and re-aggregate the day.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitRequest} className="space-y-4">
            <div className="space-y-2">
              <Label>Employee</Label>
              <Select required value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })}>
                <option value="">Select employee</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.employee_code} — {e.full_name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Attendance date</Label>
                <Input type="date" required value={form.attendance_date} onChange={(e) => setForm({ ...form, attendance_date: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Proposed in</Label>
                <Input type="datetime-local" value={form.proposed_in} onChange={(e) => setForm({ ...form, proposed_in: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Proposed out</Label>
                <Input type="datetime-local" value={form.proposed_out} onChange={(e) => setForm({ ...form, proposed_out: e.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Reason</Label>
              <Textarea required rows={3} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Missed punch due to..." />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Submit
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!decision} onOpenChange={(v) => !v && setDecision(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{decision?.status === 'Approved' ? 'Approve correction' : 'Reject correction'}</DialogTitle>
            <DialogDescription>
              {decision?.status === 'Approved'
                ? 'Approving creates the proposed punches and re-aggregates the day.'
                : 'Rejecting closes the request without inserting any punch.'}
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
