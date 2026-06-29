import { useEffect, useMemo, useState } from 'react'
import { Plus, Pencil, RefreshCw, Loader2, Save, FileText, Trash2, Copy, Eye } from 'lucide-react'
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
import { Checkbox } from '@/components/ui/checkbox'
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
import { AVAILABLE_TOKENS, LETTER_TYPES, LETTER_TYPE_LABELS, buildSampleTokenMap, buildTokenMapForEmployee, renderTemplate, type LetterType } from '@/lib/letters'
import { LetterPreviewPaper } from '@/components/letters/LetterPreviewPaper'
import { DEFAULT_LETTER_TEMPLATES } from '@/lib/defaultLetterTemplates'
import { seedDefaultLetterTemplates } from '@/lib/seedLetterTemplates'

type Template = {
  id: string
  code: string
  name: string
  letter_type: LetterType
  subject: string
  body: string
  description: string | null
  is_active: boolean
}

const emptyForm = {
  code: '',
  name: '',
  letter_type: 'GENERAL' as LetterType,
  subject: '',
  body: '',
  description: '',
  is_active: true,
}

export function LetterTemplatesPage() {
  const { appUser, hasPermission } = useAuth()
  const canManage = hasPermission('letter.template')
  const [rows, setRows] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Template | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [filterType, setFilterType] = useState('')
  const [busy, setBusy] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewTitle, setPreviewTitle] = useState('')
  const [previewSubject, setPreviewSubject] = useState('')
  const [previewBody, setPreviewBody] = useState('')
  const [previewEmployeeId, setPreviewEmployeeId] = useState('')
  const [previewEmployees, setPreviewEmployees] = useState<{ id: string; full_name: string; employee_code: string }[]>([])
  const [previewCompany, setPreviewCompany] = useState<{
    name: string
    address: string | null
    phone: string | null
    email: string | null
    logo_url: string | null
  } | null>(null)
  const [previewRaw, setPreviewRaw] = useState({ subject: '', body: '' })
  const [previewLoading, setPreviewLoading] = useState(false)

  const installDefaults = async () => {
    if (!appUser?.company_id) return
    setSeeding(true)
    const result = await seedDefaultLetterTemplates(appUser.company_id)
    setSeeding(false)
    if (result.error) {
      toast.error('Could not install templates', { description: result.error })
      return
    }
    if (result.inserted === 0) {
      toast.info('All default templates are already installed')
    } else {
      toast.success(`Installed ${result.inserted} template(s)`)
    }
    void load()
  }

  async function load() {
    setLoading(true)
    let { data, error } = await supabase.from('letter_templates').select('*').order('name')
    if (error) {
      toast.error('Failed to load templates', { description: error.message })
      setLoading(false)
      return
    }

    if (canManage && appUser?.company_id) {
      const result = await seedDefaultLetterTemplates(appUser.company_id)
      if (result.error) {
        toast.error('Could not install default templates', { description: result.error })
      } else if (result.inserted > 0) {
        const reloaded = await supabase.from('letter_templates').select('*').order('name')
        data = reloaded.data
        error = reloaded.error
        if (!error) {
          toast.success(`Added ${result.inserted} default letter template(s)`)
        }
      }
    }

    if (error) toast.error('Failed to load templates', { description: error.message })
    else setRows((data ?? []) as Template[])
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  const filtered = useMemo(
    () => (filterType ? rows.filter((r) => r.letter_type === filterType) : rows),
    [rows, filterType]
  )

  const openCreate = async () => {
    setEditing(null)
    const code = await nextCode({
      table: 'letter_templates',
      column: 'code',
      prefix: 'TPL-',
      width: 4,
      companyId: appUser?.company_id,
    })
    setForm({ ...emptyForm, code })
    setOpen(true)
  }

  const openEdit = (t: Template) => {
    setEditing(t)
    setForm({
      code: t.code,
      name: t.name,
      letter_type: t.letter_type,
      subject: t.subject,
      body: t.body,
      description: t.description ?? '',
      is_active: t.is_active,
    })
    setOpen(true)
  }

  const duplicate = async (t: Template) => {
    if (!appUser?.company_id) return
    const code = await nextCode({
      table: 'letter_templates',
      column: 'code',
      prefix: 'TPL-',
      width: 4,
      companyId: appUser.company_id,
    })
    setEditing(null)
    setForm({
      code,
      name: `${t.name} (copy)`,
      letter_type: t.letter_type,
      subject: t.subject,
      body: t.body,
      description: t.description ?? '',
      is_active: true,
    })
    setOpen(true)
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!appUser) return
    setBusy(true)
    const payload = {
      company_id: appUser.company_id,
      code: form.code.trim(),
      name: form.name.trim(),
      letter_type: form.letter_type,
      subject: form.subject.trim(),
      body: form.body,
      description: form.description.trim() || null,
      is_active: form.is_active,
    }
    if (editing) {
      const { error } = await supabase.from('letter_templates').update(payload).eq('id', editing.id)
      setBusy(false)
      if (error) {
        toast.error('Update failed', { description: error.message })
        return
      }
      await writeAuditLog({ action: 'UPDATE', entityType: 'letter_template', entityId: editing.id })
      toast.success('Template updated')
    } else {
      const { data, error } = await supabase.from('letter_templates').insert(payload).select('id').single()
      setBusy(false)
      if (error) {
        toast.error('Create failed', { description: error.message })
        return
      }
      await writeAuditLog({ action: 'CREATE', entityType: 'letter_template', entityId: data?.id })
      toast.success('Template added')
    }
    setOpen(false)
    void load()
  }

  const onDelete = async (t: Template) => {
    if (!window.confirm(`Delete template "${t.name}"?`)) return
    const { error } = await supabase.from('letter_templates').delete().eq('id', t.id)
    if (error) {
      toast.error('Delete failed', { description: error.message })
      return
    }
    toast.success('Template deleted')
    void load()
  }

  async function ensurePreviewContext() {
    if (!appUser?.company_id) return null
    if (previewCompany && previewEmployees.length > 0) return previewCompany
    const [{ data: company }, { data: emps }] = await Promise.all([
      supabase
        .from('companies')
        .select('name, address, phone, email, logo_url')
        .eq('id', appUser.company_id)
        .single(),
      supabase
        .from('employees')
        .select('id, full_name, employee_code')
        .eq('is_active', true)
        .order('full_name')
        .limit(500),
    ])
    if (company) setPreviewCompany(company)
    setPreviewEmployees((emps ?? []) as { id: string; full_name: string; employee_code: string }[])
    return company ?? previewCompany
  }

  async function renderPreview(
    subject: string,
    body: string,
    employeeId: string,
    company?: typeof previewCompany
  ) {
    const tokens = employeeId
      ? await buildTokenMapForEmployee(employeeId)
      : buildSampleTokenMap()
    const co = company ?? previewCompany
    if (!employeeId && co?.name) {
      tokens.company_name = co.name
      tokens.company_address = co.address ?? ''
    }
    return {
      subject: renderTemplate(subject, tokens),
      body: renderTemplate(body, tokens),
    }
  }

  async function openPreview(title: string, subject: string, body: string, employeeId = '') {
    setPreviewTitle(title)
    setPreviewRaw({ subject, body })
    setPreviewEmployeeId(employeeId)
    setPreviewOpen(true)
    setPreviewLoading(true)
    const company = await ensurePreviewContext()
    const rendered = await renderPreview(subject, body, employeeId, company)
    setPreviewSubject(rendered.subject)
    setPreviewBody(rendered.body)
    setPreviewLoading(false)
  }

  async function onPreviewEmployeeChange(employeeId: string) {
    setPreviewEmployeeId(employeeId)
    setPreviewLoading(true)
    const rendered = await renderPreview(previewRaw.subject, previewRaw.body, employeeId)
    setPreviewSubject(rendered.subject)
    setPreviewBody(rendered.body)
    setPreviewLoading(false)
  }

  const insertToken = (token: string) => {
    const el = document.getElementById('tpl-body') as HTMLTextAreaElement | null
    if (!el) return
    const ins = `{{${token}}}`
    const start = el.selectionStart ?? form.body.length
    const end = el.selectionEnd ?? form.body.length
    const next = form.body.slice(0, start) + ins + form.body.slice(end)
    setForm((f) => ({ ...f, body: next }))
    queueMicrotask(() => {
      el.focus()
      el.selectionStart = el.selectionEnd = start + ins.length
    })
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Letter templates"
        description="Re-usable templates for offer, experience, salary certificate, NOC, warnings, etc."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <HasPermission perm="letter.template">
              <Button variant="outline" size="sm" onClick={() => void installDefaults()} disabled={seeding}>
                {seeding ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                Install defaults ({DEFAULT_LETTER_TEMPLATES.length})
              </Button>
              <Button size="sm" onClick={() => void openCreate()}>
                <Plus className="h-4 w-4" /> New template
              </Button>
            </HasPermission>
          </>
        }
      />

      <div className="flex flex-wrap gap-3 items-end">
        <div className="min-w-[200px]">
          <Label className="text-xs">Filter by type</Label>
          <Select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
            <option value="">All types</option>
            {LETTER_TYPES.map((t) => (
              <option key={t} value={t}>
                {LETTER_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{filtered.length} template(s)</CardTitle>
          <CardDescription>Templates with variables like {'{{employee_name}}'} get auto-filled at issue time.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-12 grid place-items-center">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground space-y-4">
              <FileText className="h-8 w-8 mx-auto mb-3 opacity-50" />
              <p>No templates yet.</p>
              {canManage && (
                <Button size="sm" onClick={() => void installDefaults()} disabled={seeding}>
                  {seeding ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                  Install {DEFAULT_LETTER_TEMPLATES.length} default templates
                </Button>
              )}
            </div>
          ) : (
            <div className="divide-y">
              {filtered.map((t) => (
                <div key={t.id} className="flex flex-wrap items-center gap-3 px-6 py-3 hover:bg-muted/30">
                  <div className="flex-1 min-w-[220px]">
                    <div className="font-medium">{t.name}</div>
                    <div className="text-xs text-muted-foreground font-mono">{t.code}</div>
                    {t.description && <div className="text-xs text-muted-foreground mt-0.5">{t.description}</div>}
                  </div>
                  <Badge variant="outline" className="text-[10px]">
                    {LETTER_TYPE_LABELS[t.letter_type]}
                  </Badge>
                  {!t.is_active && <Badge variant="secondary">Inactive</Badge>}
                  <Button
                    variant="ghost"
                    size="sm"
                    title="Preview"
                    onClick={() => void openPreview(t.name, t.subject, t.body)}
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                  {canManage && (
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" title="Duplicate" onClick={() => void duplicate(t)}>
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => openEdit(t)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => void onDelete(t)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit template' : 'New template'}</DialogTitle>
            <DialogDescription>
              Use {'{{token}}'} placeholders. Click a token from the panel to insert it at the cursor.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Code</Label>
                <Input value={form.code} readOnly disabled className="font-mono" />
              </div>
              <div className="space-y-2">
                <Label>Letter type</Label>
                <Select
                  value={form.letter_type}
                  onChange={(e) => setForm({ ...form, letter_type: e.target.value as LetterType })}
                >
                  {LETTER_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {LETTER_TYPE_LABELS[t]}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Name</Label>
                <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Description</Label>
                <Input
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Brief note about when to use this template"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Subject</Label>
                <Input
                  required
                  value={form.subject}
                  onChange={(e) => setForm({ ...form, subject: e.target.value })}
                  placeholder="e.g. Offer of Employment - {{employee_name}}"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Body</Label>
                <Textarea
                  id="tpl-body"
                  required
                  rows={12}
                  className="font-mono text-sm"
                  value={form.body}
                  onChange={(e) => setForm({ ...form, body: e.target.value })}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label className="text-xs">Available tokens (click to insert)</Label>
                <div className="flex flex-wrap gap-1">
                  {AVAILABLE_TOKENS.map((tk) => (
                    <button
                      key={tk.token}
                      type="button"
                      onClick={() => insertToken(tk.token)}
                      title={tk.label}
                      className="text-[11px] font-mono px-2 py-1 rounded border bg-muted hover:bg-accent transition-colors"
                    >
                      {`{{${tk.token}}}`}
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={form.is_active}
                  onCheckedChange={(v) => setForm({ ...form, is_active: !!v })}
                />
                Active
              </label>
            </div>
            <DialogFooter className="gap-2 sm:justify-between flex-wrap">
              <Button
                type="button"
                variant="outline"
                onClick={() => void openPreview(form.name || 'Template preview', form.subject, form.body)}
                disabled={!form.subject.trim() && !form.body.trim()}
              >
                <Eye className="h-4 w-4" /> Preview
              </Button>
              <div className="flex gap-2 ml-auto">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="sm:max-w-4xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Preview — {previewTitle}</DialogTitle>
            <DialogDescription>
              Sample data is used until you pick an employee. This matches the printed letter layout.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2 max-w-md">
              <Label className="text-xs">Preview with employee (optional)</Label>
              <Select
                value={previewEmployeeId}
                onChange={(e) => void onPreviewEmployeeChange(e.target.value)}
              >
                <option value="">Sample data</option>
                {previewEmployees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.full_name} ({e.employee_code})
                  </option>
                ))}
              </Select>
            </div>
            {previewLoading ? (
              <div className="py-16 grid place-items-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="rounded-lg border bg-muted/30 p-4 overflow-x-auto">
                <LetterPreviewPaper
                  subject={previewSubject}
                  body={previewBody}
                  letterNo="LT-PREVIEW"
                  company={previewCompany}
                  compact
                />
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
