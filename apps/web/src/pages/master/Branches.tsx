import { useEffect, useState } from 'react'
import { Plus, Pencil, RefreshCw, Loader2, Building2, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { writeAuditLog } from '@/lib/audit'
import { nextCode } from '@/lib/codegen'
import { PK_PROVINCES, WEEK_DAYS } from '@/lib/constants'
import { PageHeader } from '@/components/master/PageHeader'
import { HasPermission } from '@/components/HasPermission'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { sortByMasterCode } from '@/lib/utils'
import { toast } from 'sonner'

type Branch = {
  id: string
  code: string
  name: string
  city: string | null
  province: string | null
  phone: string | null
  weekly_off_days: number[]
  default_shift_start: string | null
  default_shift_end: string | null
  is_active: boolean
}

const emptyForm = {
  code: '',
  name: '',
  address: '',
  city: '',
  province: '',
  phone: '',
  weekly_off_days: [0] as number[],
  default_shift_start: '09:00',
  default_shift_end: '18:00',
  geofence_radius_m: 200,
  is_active: true,
}

export function BranchesPage() {
  const { appUser, hasPermission } = useAuth()
  const canCreate = hasPermission('branch.create')
  const canUpdate = hasPermission('branch.update')
  const canDelete = hasPermission('branch.delete')
  const [rows, setRows] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Branch | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [busy, setBusy] = useState(false)

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('branches')
      .select('id, code, name, city, province, phone, weekly_off_days, default_shift_start, default_shift_end, is_active')
    if (error) toast.error('Failed to load branches', { description: error.message })
    else setRows(sortByMasterCode((data ?? []) as Branch[]))
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  const openCreate = async () => {
    setEditing(null)
    const code = await nextCode({
      table: 'branches',
      column: 'code',
      prefix: 'BR-',
      width: 3,
      companyId: appUser?.company_id,
    })
    setForm({ ...emptyForm, code })
    setOpen(true)
  }

  const openEdit = (b: Branch) => {
    setEditing(b)
    setForm({
      code: b.code,
      name: b.name,
      address: '',
      city: b.city ?? '',
      province: b.province ?? '',
      phone: b.phone ?? '',
      weekly_off_days: b.weekly_off_days ?? [0],
      default_shift_start: b.default_shift_start?.slice(0, 5) ?? '09:00',
      default_shift_end: b.default_shift_end?.slice(0, 5) ?? '18:00',
      geofence_radius_m: 200,
      is_active: b.is_active,
    })
    setOpen(true)
  }

  const toggleOffDay = (day: number) => {
    setForm((f) => {
      const has = f.weekly_off_days.includes(day)
      return {
        ...f,
        weekly_off_days: has ? f.weekly_off_days.filter((d) => d !== day) : [...f.weekly_off_days, day],
      }
    })
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!appUser) return
    setBusy(true)
    const payload = {
      company_id: appUser.company_id,
      code: form.code.trim(),
      name: form.name.trim(),
      address: form.address || null,
      city: form.city || null,
      province: form.province || null,
      phone: form.phone || null,
      weekly_off_days: form.weekly_off_days,
      default_shift_start: form.default_shift_start || null,
      default_shift_end: form.default_shift_end || null,
      geofence_radius_m: form.geofence_radius_m,
      is_active: form.is_active,
    }

    if (editing) {
      const { error } = await supabase.from('branches').update(payload).eq('id', editing.id)
      setBusy(false)
      if (error) {
        toast.error('Update failed', { description: error.message })
        return
      }
      await writeAuditLog({
        action: 'UPDATE',
        entityType: 'branch',
        entityId: editing.id,
        after: payload as Record<string, unknown>,
      })
      toast.success('Branch updated')
    } else {
      const { data, error } = await supabase.from('branches').insert(payload).select('id').single()
      setBusy(false)
      if (error) {
        toast.error('Create failed', { description: error.message })
        return
      }
      await writeAuditLog({
        action: 'CREATE',
        entityType: 'branch',
        entityId: data?.id,
        after: payload as Record<string, unknown>,
      })
      toast.success('Branch created')
    }
    setOpen(false)
    void load()
  }

  const onDelete = async (b: Branch) => {
    // Block delete when employees still assigned to this branch
    const { count, error: countErr } = await supabase
      .from('employees')
      .select('id', { count: 'exact', head: true })
      .eq('branch_id', b.id)
    if (countErr) {
      toast.error('Could not verify employees', { description: countErr.message })
      return
    }
    if (count && count > 0) {
      toast.error('Cannot delete branch', {
        description: `${count} employee(s) are still assigned to "${b.name}". Reassign them first.`,
      })
      return
    }

    if (!window.confirm(`Delete branch "${b.name}" (${b.code})? This cannot be undone.`)) return

    setBusy(true)
    const { error } = await supabase.from('branches').delete().eq('id', b.id)
    setBusy(false)
    if (error) {
      toast.error('Delete failed', { description: error.message })
      return
    }
    await writeAuditLog({ action: 'DELETE', entityType: 'branch', entityId: b.id })
    toast.success('Branch deleted')
    if (editing?.id === b.id) setOpen(false)
    void load()
  }

  const offLabel = (days: number[]) =>
    days.map((d) => WEEK_DAYS.find((w) => w.value === d)?.label?.slice(0, 3) ?? d).join(', ')

  return (
    <div className="space-y-6">
      <PageHeader
        title="Branches"
        description="Each branch can have its own weekly off days and default shift times."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
            <HasPermission perm="branch.create">
              <Button size="sm" onClick={() => void openCreate()}>
                <Plus className="h-4 w-4" /> Add branch
              </Button>
            </HasPermission>
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All branches</CardTitle>
          <CardDescription>{rows.length} total</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-12 grid place-items-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : rows.length === 0 ? (
            <div className="p-12 text-center">
              <Building2 className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No branches yet — add your first office or factory location.</p>
              {canCreate && (
                <Button size="sm" className="mt-4" onClick={() => void openCreate()}>
                  <Plus className="h-4 w-4" /> Add branch
                </Button>
              )}
            </div>
          ) : (
            <div className="divide-y">
              {rows.map((b) => (
                <div key={b.id} className="flex flex-wrap items-center gap-4 px-6 py-4 hover:bg-muted/30">
                  <div className="flex-1 min-w-[200px]">
                    <div className="font-medium">
                      <span className="font-mono text-muted-foreground">{b.code}</span>
                      <span className="mx-2 text-muted-foreground/50">·</span>
                      {b.name}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {[b.city, b.province].filter(Boolean).join(', ') || 'No location set'}
                    </div>
                  </div>
                  <div className="text-sm text-muted-foreground">Off: {offLabel(b.weekly_off_days)}</div>
                  {b.default_shift_start && b.default_shift_end && (
                    <div className="text-sm text-muted-foreground">
                      {b.default_shift_start.slice(0, 5)} – {b.default_shift_end.slice(0, 5)}
                    </div>
                  )}
                  {!b.is_active && <Badge variant="secondary">Inactive</Badge>}
                  <div className="flex items-center gap-1">
                    {canUpdate && (
                      <Button variant="ghost" size="sm" title="Edit branch" onClick={() => openEdit(b)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                    {canDelete && (
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Delete branch"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        disabled={busy}
                        onClick={() => void onDelete(b)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit branch' : 'Add branch'}</DialogTitle>
            <DialogDescription>Branch calendar settings apply to employees assigned here.</DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2 sm:col-span-2">
                <Label>Name</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Code</Label>
                <Input value={form.code} readOnly disabled className="font-mono max-w-[12rem]" />
                <p className="text-xs text-muted-foreground">
                  {editing ? 'Codes are immutable.' : 'Auto-generated BR-001, BR-002, …'}
                </p>
              </div>
              <div className="space-y-2">
                <Label>City</Label>
                <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Province</Label>
                <Select value={form.province} onChange={(e) => setForm({ ...form, province: e.target.value })}>
                  <option value="">Select…</option>
                  {PK_PROVINCES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Geofence (meters)</Label>
                <Input
                  type="number"
                  value={form.geofence_radius_m}
                  onChange={(e) => setForm({ ...form, geofence_radius_m: +e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Shift start</Label>
                <Input type="time" value={form.default_shift_start} onChange={(e) => setForm({ ...form, default_shift_start: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Shift end</Label>
                <Input type="time" value={form.default_shift_end} onChange={(e) => setForm({ ...form, default_shift_end: e.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Weekly off days</Label>
              <div className="flex flex-wrap gap-2">
                {WEEK_DAYS.map((d) => (
                  <label key={d.value} className="flex items-center gap-1.5 text-sm border rounded-lg px-2 py-1.5 cursor-pointer hover:bg-muted/50">
                    <Checkbox checked={form.weekly_off_days.includes(d.value)} onCheckedChange={() => toggleOffDay(d.value)} />
                    {d.label}
                  </label>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: !!v })} />
              Active
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {editing ? 'Save' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
