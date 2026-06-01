import { useEffect, useState } from 'react'
import { Plus, Pencil, RefreshCw, Loader2, GraduationCap } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { writeAuditLog } from '@/lib/audit'
import { nextCode } from '@/lib/codegen'
import { PageHeader } from '@/components/master/PageHeader'
import { HasPermission } from '@/components/HasPermission'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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

type Designation = {
  id: string
  code: string
  title: string
  grade: string | null
  is_active: boolean
}

export function DesignationsPage() {
  const { appUser, hasPermission } = useAuth()
  const canCreate = hasPermission('designation.create')
  const canUpdate = hasPermission('designation.update')
  const [rows, setRows] = useState<Designation[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Designation | null>(null)
  const [form, setForm] = useState({ code: '', title: '', grade: '', is_active: true })
  const [busy, setBusy] = useState(false)

  async function load() {
    setLoading(true)
    const { data, error } = await supabase.from('designations').select('id, code, title, grade, is_active')
    if (error) toast.error('Failed to load', { description: error.message })
    else setRows(sortByMasterCode((data ?? []) as Designation[]))
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!appUser) return
    setBusy(true)
    const payload = {
      company_id: appUser.company_id,
      code: form.code.trim(),
      title: form.title.trim(),
      grade: form.grade || null,
      is_active: form.is_active,
    }

    if (editing) {
      const { error } = await supabase.from('designations').update(payload).eq('id', editing.id)
      setBusy(false)
      if (error) {
        toast.error('Update failed', { description: error.message })
        return
      }
      await writeAuditLog({ action: 'UPDATE', entityType: 'designation', entityId: editing.id })
      toast.success('Designation updated')
    } else {
      const { data, error } = await supabase.from('designations').insert(payload).select('id').single()
      setBusy(false)
      if (error) {
        toast.error('Create failed', { description: error.message })
        return
      }
      await writeAuditLog({ action: 'CREATE', entityType: 'designation', entityId: data?.id })
      toast.success('Designation created')
    }
    setOpen(false)
    void load()
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Designations"
        description="Job titles and grades used on employee records."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
            <HasPermission perm="designation.create">
              <Button
                size="sm"
                onClick={async () => {
                  setEditing(null)
                  const code = await nextCode({
                    table: 'designations',
                    column: 'code',
                    prefix: 'DES-',
                    width: 3,
                    companyId: appUser?.company_id,
                  })
                  setForm({ code, title: '', grade: '', is_active: true })
                  setOpen(true)
                }}
              >
                <Plus className="h-4 w-4" /> Add designation
              </Button>
            </HasPermission>
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All designations</CardTitle>
          <CardDescription>{rows.length} total</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-12 grid place-items-center">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : rows.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">
              <GraduationCap className="h-8 w-8 mx-auto mb-3 opacity-50" />
              No designations yet.
            </div>
          ) : (
            <div className="divide-y">
              {rows.map((d) => (
                <div key={d.id} className="flex items-center gap-4 px-6 py-3 hover:bg-muted/30">
                  <div className="flex-1">
                    <div className="font-medium">{d.title}</div>
                    <div className="text-sm text-muted-foreground">
                      {d.code}
                      {d.grade && ` · Grade ${d.grade}`}
                    </div>
                  </div>
                  {!d.is_active && <Badge variant="secondary">Inactive</Badge>}
                  {canUpdate && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditing(d)
                        setForm({ code: d.code, title: d.title, grade: d.grade ?? '', is_active: d.is_active })
                        setOpen(true)
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit designation' : 'Add designation'}</DialogTitle>
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
                <Label>Title</Label>
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Grade (optional)</Label>
                <Input value={form.grade} onChange={(e) => setForm({ ...form, grade: e.target.value })} placeholder="e.g. G5" />
              </div>
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
