import { useCallback, useEffect, useState } from 'react'
import { Plus, Pencil, RefreshCw, Loader2, Briefcase, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { writeAuditLog } from '@/lib/audit'
import {
  hasDepartmentCodeIssues,
  nextDepartmentCode,
  STANDARD_DEPARTMENTS,
  syncStandardDepartments,
} from '@/lib/departmentCodes'
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

type Dept = {
  id: string
  code: string
  name: string
  parent_id: string | null
  is_active: boolean
}

export function DepartmentsPage() {
  const { appUser, hasPermission } = useAuth()
  const canCreate = hasPermission('department.create')
  const canUpdate = hasPermission('department.update')
  const canDelete = hasPermission('department.delete')
  const canSync = hasPermission('department.update') || hasPermission('department.create')
  const [rows, setRows] = useState<Dept[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Dept | null>(null)
  const [form, setForm] = useState({ code: '', name: '', parent_id: '', is_active: true })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!appUser?.company_id) return
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('departments')
        .select('id, code, name, parent_id, is_active, created_at')

      if (error) {
        toast.error('Failed to load', { description: error.message })
        setRows([])
        return
      }

      let list = sortByMasterCode((data ?? []) as (Dept & { created_at?: string })[])

      if (canSync) {
        try {
          const { created, updated } = await syncStandardDepartments(appUser.company_id)
          const { data: refreshed, error: reloadErr } = await supabase
            .from('departments')
            .select('id, code, name, parent_id, is_active')
          if (reloadErr) toast.error('Reload failed', { description: reloadErr.message })
          else list = sortByMasterCode((refreshed ?? []) as Dept[])
          if (created > 0 || updated > 0) {
            toast.success('Departments applied', {
              description: `${created} added, ${updated} updated — DEPT-001 to DEPT-${String(STANDARD_DEPARTMENTS.length).padStart(3, '0')}`,
            })
          }
        } catch (syncErr) {
          toast.error('Could not apply departments', {
            description: syncErr instanceof Error ? syncErr.message : 'Unknown error',
          })
        }
      }

      setRows(list)
    } catch (e) {
      toast.error('Failed to load departments', {
        description: e instanceof Error ? e.message : 'Unknown error',
      })
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [appUser?.company_id, canSync])

  useEffect(() => {
    void load()
  }, [load])

  const parentName = (id: string | null) => rows.find((r) => r.id === id)?.name

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!appUser) return
    setBusy(true)
    const payload = {
      company_id: appUser.company_id,
      code: form.code.trim(),
      name: form.name.trim(),
      parent_id: form.parent_id || null,
      is_active: form.is_active,
    }

    if (editing) {
      const { error } = await supabase.from('departments').update(payload).eq('id', editing.id)
      setBusy(false)
      if (error) {
        toast.error('Update failed', { description: error.message })
        return
      }
      await writeAuditLog({ action: 'UPDATE', entityType: 'department', entityId: editing.id })
      toast.success('Department updated')
    } else {
      const { data, error } = await supabase.from('departments').insert(payload).select('id').single()
      setBusy(false)
      if (error) {
        toast.error('Create failed', { description: error.message })
        return
      }
      await writeAuditLog({ action: 'CREATE', entityType: 'department', entityId: data?.id })
      toast.success('Department created')
    }
    setOpen(false)
    void load()
  }

  const onDelete = async (d: Dept) => {
    const children = rows.filter((r) => r.parent_id === d.id)
    if (children.length > 0) {
      toast.error('Cannot delete department', {
        description: `"${d.name}" has ${children.length} sub-department(s). Delete or move them first.`,
      })
      return
    }

    const { count, error: countErr } = await supabase
      .from('employees')
      .select('id', { count: 'exact', head: true })
      .eq('department_id', d.id)
    if (countErr) {
      toast.error('Could not verify employees', { description: countErr.message })
      return
    }
    if (count && count > 0) {
      toast.error('Cannot delete department', {
        description: `${count} employee(s) are still assigned to "${d.name}". Reassign them first.`,
      })
      return
    }

    if (!window.confirm(`Delete department "${d.name}" (${d.code})? This cannot be undone.`)) return

    setBusy(true)
    const { error } = await supabase.from('departments').delete().eq('id', d.id)
    setBusy(false)
    if (error) {
      toast.error('Delete failed', { description: error.message })
      return
    }
    await writeAuditLog({ action: 'DELETE', entityType: 'department', entityId: d.id })
    toast.success('Department deleted')
    if (editing?.id === d.id) setOpen(false)
    void load()
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Departments"
        description="Organize employees into departments and sub-departments."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
            {canSync && (
              <Button
                size="sm"
                variant="secondary"
                disabled={busy || loading}
                onClick={async () => {
                  if (!appUser?.company_id) return
                  setBusy(true)
                  try {
                    const { created, updated } = await syncStandardDepartments(appUser.company_id)
                    toast.success('Standard departments applied', {
                      description: `${created} added, ${updated} codes updated`,
                    })
                    await load()
                  } catch (e) {
                    toast.error('Sync failed', {
                      description: e instanceof Error ? e.message : 'Unknown error',
                    })
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                Apply DEPT-001…009
              </Button>
            )}
            <HasPermission perm="department.create">
              <Button
                size="sm"
                onClick={async () => {
                  setEditing(null)
                  const code = await nextDepartmentCode(appUser!.company_id)
                  setForm({ code, name: '', parent_id: '', is_active: true })
                  setOpen(true)
                }}
              >
                <Plus className="h-4 w-4" /> Add department
              </Button>
            </HasPermission>
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All departments</CardTitle>
          <CardDescription>
            {rows.length} total · standard order DEPT-001 ({STANDARD_DEPARTMENTS[0]}) … DEPT-
            {String(STANDARD_DEPARTMENTS.length).padStart(3, '0')} ({STANDARD_DEPARTMENTS.at(-1)})
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-12 grid place-items-center">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : rows.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">
              <Briefcase className="h-8 w-8 mx-auto mb-3 opacity-50" />
              No departments yet.
              {canCreate && (
                <Button
                  size="sm"
                  className="mt-4"
                  onClick={async () => {
                    setEditing(null)
                    const code = await nextDepartmentCode(appUser!.company_id)
                    setForm({ code, name: '', parent_id: '', is_active: true })
                    setOpen(true)
                  }}
                >
                  <Plus className="h-4 w-4" /> Add department
                </Button>
              )}
            </div>
          ) : (
            <div className="divide-y">
              {rows.map((d) => (
                <div key={d.id} className="flex items-center gap-4 px-6 py-3 hover:bg-muted/30">
                  <div className="flex-1">
                    <div className="font-medium">{d.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {d.code}
                      {d.parent_id && ` · under ${parentName(d.parent_id)}`}
                    </div>
                  </div>
                  {!d.is_active && <Badge variant="secondary">Inactive</Badge>}
                  <div className="flex items-center gap-1">
                    {canUpdate && (
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Edit department"
                        onClick={() => {
                          setEditing(d)
                          setForm({
                            code: d.code,
                            name: d.name,
                            parent_id: d.parent_id ?? '',
                            is_active: d.is_active,
                          })
                          setOpen(true)
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                    {canDelete && (
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Delete department"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        disabled={busy}
                        onClick={() => void onDelete(d)}
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit department' : 'Add department'}</DialogTitle>
            <DialogDescription>Optional parent for sub-departments.</DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Code</Label>
                <Input value={form.code} readOnly disabled className="font-mono" />
                <p className="text-xs text-muted-foreground">
                  {editing ? 'Codes are immutable.' : 'Auto-generated.'}
                </p>
              </div>
              <div className="space-y-2">
                <Label>Name</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Parent department</Label>
              <Select value={form.parent_id} onChange={(e) => setForm({ ...form, parent_id: e.target.value })}>
                <option value="">None (top level)</option>
                {rows
                  .filter((r) => r.id !== editing?.id)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
              </Select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: !!v })} />
              Active
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
