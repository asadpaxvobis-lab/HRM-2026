import { useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, Pencil, Trash2, Wallet, Save } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { writeAuditLog } from '@/lib/audit'
import { PAY_FREQUENCIES } from '@/lib/constants'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  AllowanceToggleField,
  compGrossFromForm,
  defaultAllowanceFlags,
  validateAllowanceForm,
} from '@/components/payroll/AllowanceToggleField'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from 'sonner'

type Salary = {
  id: string
  effective_from: string
  effective_to: string | null
  basic: number
  house_rent: number
  medical: number
  conveyance: number
  utilities: number
  other_allowances: number
  pay_frequency: string
  currency: string
  revision_reason: string | null
  notes: string | null
  house_rent_enabled: boolean
  medical_enabled: boolean
  conveyance_enabled: boolean
  utilities_enabled: boolean
  other_allowances_enabled: boolean
}

const today = () => new Date().toISOString().slice(0, 10)

const emptyForm = {
  effective_from: today(),
  effective_to: '',
  basic: 0,
  house_rent: 0,
  medical: 0,
  conveyance: 0,
  utilities: 0,
  other_allowances: 0,
  pay_frequency: 'Monthly',
  currency: 'PKR',
  revision_reason: '',
  notes: '',
  ...defaultAllowanceFlags(),
}

const pkr = (n: number) => `PKR ${Number(n).toLocaleString('en-PK', { maximumFractionDigits: 0 })}`

function validateCompForm(form: typeof emptyForm): string | null {
  if (!form.effective_from) return 'Effective from is required'
  if (!form.pay_frequency) return 'Pay frequency is required'
  if (form.basic <= 0) return 'Basic salary is required (must be greater than 0)'
  return validateAllowanceForm(form)
}

export function CompensationTab({ employeeId }: { employeeId: string }) {
  const { hasPermission } = useAuth()
  const canEdit = hasPermission('payroll.salary') || hasPermission('payroll.config')
  const [rows, setRows] = useState<Salary[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Salary | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [busy, setBusy] = useState(false)

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('employee_salary_history')
      .select('*')
      .eq('employee_id', employeeId)
      .order('effective_from', { ascending: false })
    if (error) toast.error('Failed to load compensation', { description: error.message })
    else setRows((data ?? []) as Salary[])
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [employeeId])

  const gross = useMemo(() => compGrossFromForm(+form.basic, form), [form])

  const openCreate = () => {
    setEditing(null)
    const last = rows[0]
    setForm(
      last
        ? {
            effective_from: today(),
            effective_to: '',
            basic: last.basic,
            house_rent: last.house_rent,
            medical: last.medical,
            conveyance: last.conveyance,
            utilities: last.utilities,
            other_allowances: last.other_allowances,
            pay_frequency: last.pay_frequency,
            currency: last.currency,
            revision_reason: '',
            notes: '',
            house_rent_enabled: last.house_rent_enabled === true,
            medical_enabled: last.medical_enabled === true,
            conveyance_enabled: last.conveyance_enabled === true,
            utilities_enabled: last.utilities_enabled === true,
            other_allowances_enabled: last.other_allowances_enabled === true,
          }
        : emptyForm
    )
    setOpen(true)
  }

  const openEdit = (s: Salary) => {
    setEditing(s)
    setForm({
      effective_from: s.effective_from,
      effective_to: s.effective_to ?? '',
      basic: +s.basic,
      house_rent: +s.house_rent,
      medical: +s.medical,
      conveyance: +s.conveyance,
      utilities: +s.utilities,
      other_allowances: +s.other_allowances,
      pay_frequency: s.pay_frequency,
      currency: s.currency,
      revision_reason: s.revision_reason ?? '',
      notes: s.notes ?? '',
      house_rent_enabled: s.house_rent_enabled === true,
      medical_enabled: s.medical_enabled === true,
      conveyance_enabled: s.conveyance_enabled === true,
      utilities_enabled: s.utilities_enabled === true,
      other_allowances_enabled: s.other_allowances_enabled === true,
    })
    setOpen(true)
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const err = validateCompForm(form)
    if (err) {
      toast.error(err)
      return
    }
    setBusy(true)
    const payload = {
      employee_id: employeeId,
      effective_from: form.effective_from,
      effective_to: form.effective_to || null,
      basic: +form.basic,
      house_rent: +form.house_rent,
      medical: +form.medical,
      conveyance: +form.conveyance,
      utilities: +form.utilities,
      other_allowances: +form.other_allowances,
      pay_frequency: form.pay_frequency,
      currency: form.currency,
      revision_reason: form.revision_reason.trim() || null,
      notes: form.notes.trim() || null,
      house_rent_enabled: form.house_rent_enabled,
      medical_enabled: form.medical_enabled,
      conveyance_enabled: form.conveyance_enabled,
      utilities_enabled: form.utilities_enabled,
      other_allowances_enabled: form.other_allowances_enabled,
    }
    if (editing) {
      const { error } = await supabase.from('employee_salary_history').update(payload).eq('id', editing.id)
      setBusy(false)
      if (error) {
        toast.error('Update failed', { description: error.message })
        return
      }
      await writeAuditLog({ action: 'UPDATE', entityType: 'employee_salary_history', entityId: editing.id, after: payload })
      toast.success('Compensation updated')
    } else {
      const { data, error } = await supabase.from('employee_salary_history').insert(payload).select('id').single()
      setBusy(false)
      if (error) {
        toast.error('Save failed', { description: error.message })
        return
      }
      await writeAuditLog({ action: 'CREATE', entityType: 'employee_salary_history', entityId: data?.id, after: payload })
      toast.success('Compensation recorded')
    }
    setOpen(false)
    void load()
  }

  const onDelete = async (id: string) => {
    if (!confirm('Remove this salary record?')) return
    const { error } = await supabase.from('employee_salary_history').delete().eq('id', id)
    if (error) {
      toast.error('Delete failed', { description: error.message })
      return
    }
    await writeAuditLog({ action: 'DELETE', entityType: 'employee_salary_history', entityId: id })
    toast.success('Record removed')
    void load()
  }

  if (loading) {
    return (
      <div className="grid place-items-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const current = rows[0]

  return (
    <div className="space-y-6">
      {current ? (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between">
            <div>
              <CardTitle className="text-base">Current compensation</CardTitle>
              <CardDescription>
                Effective {current.effective_from}
                {current.effective_to ? ` until ${current.effective_to}` : ''} · {current.pay_frequency}
              </CardDescription>
            </div>
            {canEdit && (
              <Button size="sm" variant="outline" onClick={openCreate}>
                <Plus className="h-4 w-4" /> New revision
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <div className="grid sm:grid-cols-2 gap-3 text-sm">
              <Pair label="Basic" value={pkr(current.basic)} />
              {current.house_rent_enabled && <Pair label="House rent" value={pkr(current.house_rent)} />}
              {current.medical_enabled && <Pair label="Medical" value={pkr(current.medical)} />}
              {current.conveyance_enabled && <Pair label="Conveyance" value={pkr(current.conveyance)} />}
              {current.utilities_enabled && <Pair label="Utilities" value={pkr(current.utilities)} />}
              {current.other_allowances_enabled && (
                <Pair label="Other / incentive" value={pkr(current.other_allowances)} />
              )}
            </div>
            <div className="mt-6 flex items-center justify-between p-4 rounded-lg bg-primary/5 border border-primary/20">
              <span className="text-sm font-medium text-muted-foreground">Gross ({current.pay_frequency})</span>
              <span className="text-lg font-semibold tabular-nums">
                {pkr(
                  compGrossFromForm(+current.basic, {
                    house_rent: +current.house_rent,
                    medical: +current.medical,
                    conveyance: +current.conveyance,
                    utilities: +current.utilities,
                    other_allowances: +current.other_allowances,
                    house_rent_enabled: current.house_rent_enabled === true,
                    medical_enabled: current.medical_enabled === true,
                    conveyance_enabled: current.conveyance_enabled === true,
                    utilities_enabled: current.utilities_enabled === true,
                    other_allowances_enabled: current.other_allowances_enabled === true,
                  })
                )}
              </span>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <Wallet className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
            <p className="text-sm text-muted-foreground mb-4">No compensation recorded yet.</p>
            {canEdit && (
              <Button size="sm" onClick={openCreate}>
                <Plus className="h-4 w-4" /> Record compensation
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {rows.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">History</CardTitle>
            <CardDescription>{rows.length - 1} previous revision(s)</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {rows.slice(1).map((s) => {
                const total = compGrossFromForm(+s.basic, {
                  house_rent: +s.house_rent,
                  medical: +s.medical,
                  conveyance: +s.conveyance,
                  utilities: +s.utilities,
                  other_allowances: +s.other_allowances,
                  house_rent_enabled: s.house_rent_enabled === true,
                  medical_enabled: s.medical_enabled === true,
                  conveyance_enabled: s.conveyance_enabled === true,
                  utilities_enabled: s.utilities_enabled === true,
                  other_allowances_enabled: s.other_allowances_enabled === true,
                })
                return (
                  <div key={s.id} className="flex flex-wrap items-center gap-3 px-6 py-3">
                    <div className="w-44 text-sm tabular-nums">
                      {s.effective_from} → {s.effective_to ?? 'open'}
                    </div>
                    <div className="flex-1 min-w-[120px] text-sm font-medium tabular-nums">{pkr(total)}</div>
                    <Badge variant="outline">{s.pay_frequency}</Badge>
                    {s.revision_reason && (
                      <span className="text-xs text-muted-foreground truncate max-w-[200px]">{s.revision_reason}</span>
                    )}
                    {canEdit && (
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(s)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => void onDelete(s.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit compensation' : 'New compensation revision'}</DialogTitle>
            <DialogDescription>All amounts are per the chosen pay frequency.</DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="grid sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Effective from *</Label>
                <Input type="date" required value={form.effective_from} onChange={(e) => setForm({ ...form, effective_from: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Effective to (optional)</Label>
                <Input type="date" value={form.effective_to} onChange={(e) => setForm({ ...form, effective_to: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Pay frequency *</Label>
                <Select required value={form.pay_frequency} onChange={(e) => setForm({ ...form, pay_frequency: e.target.value })}>
                  {PAY_FREQUENCIES.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </Select>
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <MoneyField label="Basic *" value={form.basic} onChange={(v) => setForm({ ...form, basic: v })} required />
              <AllowanceToggleField
                label="House rent allowance"
                enabled={form.house_rent_enabled}
                amount={form.house_rent}
                onEnabledChange={(v) => setForm({ ...form, house_rent_enabled: v })}
                onAmountChange={(v) => setForm({ ...form, house_rent: v })}
              />
              <AllowanceToggleField
                label="Medical allowance"
                enabled={form.medical_enabled}
                amount={form.medical}
                onEnabledChange={(v) => setForm({ ...form, medical_enabled: v })}
                onAmountChange={(v) => setForm({ ...form, medical: v })}
              />
              <AllowanceToggleField
                label="Conveyance allowance"
                enabled={form.conveyance_enabled}
                amount={form.conveyance}
                onEnabledChange={(v) => setForm({ ...form, conveyance_enabled: v })}
                onAmountChange={(v) => setForm({ ...form, conveyance: v })}
              />
              <AllowanceToggleField
                label="Utilities allowance"
                enabled={form.utilities_enabled}
                amount={form.utilities}
                onEnabledChange={(v) => setForm({ ...form, utilities_enabled: v })}
                onAmountChange={(v) => setForm({ ...form, utilities: v })}
              />
              <AllowanceToggleField
                label="Other allowances / incentive"
                enabled={form.other_allowances_enabled}
                amount={form.other_allowances}
                onEnabledChange={(v) => setForm({ ...form, other_allowances_enabled: v })}
                onAmountChange={(v) => setForm({ ...form, other_allowances: v })}
              />
            </div>
            <div className="flex items-center justify-between p-3 rounded-md bg-muted text-sm">
              <span>Gross ({form.pay_frequency})</span>
              <span className="font-semibold tabular-nums">{pkr(gross)}</span>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Revision reason</Label>
                <Input value={form.revision_reason} onChange={(e) => setForm({ ...form, revision_reason: e.target.value })} placeholder="Annual increment, promotion, etc." />
              </div>
              <div className="space-y-2">
                <Label>Notes</Label>
                <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium tabular-nums">{value}</div>
    </div>
  )
}

function MoneyField({ label, value, onChange, required }: { label: string; value: number; onChange: (v: number) => void; required?: boolean }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input
        type="number"
        min={0}
        step={1}
        value={value}
        onChange={(e) => onChange(+e.target.value || 0)}
        required={required}
      />
    </div>
  )
}
