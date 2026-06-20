import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Loader2, Save, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { writeAuditLog } from '@/lib/audit'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { avatarColorFor, initialsFromName } from '@/lib/utils'
import { toast } from 'sonner'
import { ShiftAssignmentTab } from '@/components/employee/ShiftAssignmentTab'
import { CompensationTab } from '@/components/employee/CompensationTab'
import { DocumentsTab } from '@/components/employee/DocumentsTab'
import { BankTab } from '@/components/employee/BankTab'
import { DeleteEmployeeDialog } from '@/components/employee/DeleteEmployeeDialog'

type Statutory = {
  id?: string
  effective_from: string
  eobi_enabled: boolean
  eobi_custom_amount: string
  pf_enabled: boolean
  pf_employee_pct: string
  pf_employer_pct: string
  social_security_enabled: boolean
  social_security_custom_amount: string
  income_tax_enabled: boolean
}

const defaultStatutory = (): Statutory => ({
  effective_from: new Date().toISOString().slice(0, 10),
  eobi_enabled: false,
  eobi_custom_amount: '',
  pf_enabled: false,
  pf_employee_pct: '',
  pf_employer_pct: '',
  social_security_enabled: false,
  social_security_custom_amount: '',
  income_tax_enabled: false,
})

export function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { hasPermission } = useAuth()
  const canUpdate = hasPermission('employee.update')
  const canDelete = hasPermission('employee.delete')
  type Tab = 'profile' | 'statutory' | 'shifts' | 'compensation' | 'bank' | 'documents'
  const tabParam = searchParams.get('tab')
  const [tab, setTab] = useState<Tab>(
    tabParam === 'compensation' ||
      tabParam === 'statutory' ||
      tabParam === 'shifts' ||
      tabParam === 'bank' ||
      tabParam === 'documents'
      ? tabParam
      : 'profile'
  )
  const [loading, setLoading] = useState(true)
  const [employee, setEmployee] = useState<Record<string, unknown> | null>(null)
  const [statutory, setStatutory] = useState<Statutory>(defaultStatutory())
  const [saving, setSaving] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [recentPunches, setRecentPunches] = useState<
    { punch_at: string; punch_type: string; attendance_devices: { name: string } | null }[]
  >([])

  useEffect(() => {
    if (!id) return
    void (async () => {
      setLoading(true)
      const [emp, stat, punches] = await Promise.all([
        supabase
          .from('employees')
          .select(`*, branches(name), departments(name), designations(title)`)
          .eq('id', id)
          .single(),
        supabase
          .from('employee_statutory_enrollment')
          .select('*')
          .eq('employee_id', id)
          .order('effective_from', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('attendance_punches')
          .select('punch_at, punch_type, attendance_devices(name)')
          .eq('employee_id', id)
          .order('punch_at', { ascending: false })
          .limit(8),
      ])
      if (emp.error) {
        toast.error('Employee not found')
        navigate('/employees')
        return
      }
      setEmployee(emp.data as Record<string, unknown>)
      if (stat.data) {
        const s = stat.data
        setStatutory({
          id: s.id,
          effective_from: s.effective_from,
          eobi_enabled: s.eobi_enabled,
          eobi_custom_amount: s.eobi_custom_amount?.toString() ?? '',
          pf_enabled: s.pf_enabled,
          pf_employee_pct: s.pf_employee_pct?.toString() ?? '',
          pf_employer_pct: s.pf_employer_pct?.toString() ?? '',
          social_security_enabled: s.social_security_enabled,
          social_security_custom_amount: s.social_security_custom_amount?.toString() ?? '',
          income_tax_enabled: s.income_tax_enabled === true,
        })
      }
      setRecentPunches(
        (punches.data ?? []).map((p) => {
          const row = p as {
            punch_at: string
            punch_type: string
            attendance_devices?: { name: string } | { name: string }[] | null
          }
          const dev = row.attendance_devices
          const device = Array.isArray(dev) ? dev[0] ?? null : dev ?? null
          return { punch_at: row.punch_at, punch_type: row.punch_type, attendance_devices: device }
        })
      )
      setLoading(false)
    })()
  }, [id, navigate])

  const saveStatutory = async () => {
    if (!id || !canUpdate) return
    setSaving(true)
    const payload = {
      employee_id: id,
      effective_from: statutory.effective_from,
      eobi_enabled: statutory.eobi_enabled,
      eobi_custom_amount: statutory.eobi_custom_amount ? +statutory.eobi_custom_amount : null,
      pf_enabled: statutory.pf_enabled,
      pf_employee_pct: statutory.pf_employee_pct ? +statutory.pf_employee_pct : null,
      pf_employer_pct: statutory.pf_employer_pct ? +statutory.pf_employer_pct : null,
      social_security_enabled: statutory.social_security_enabled,
      social_security_custom_amount: statutory.social_security_custom_amount
        ? +statutory.social_security_custom_amount
        : null,
      income_tax_enabled: statutory.income_tax_enabled,
    }

    let error
    if (statutory.id) {
      ;({ error } = await supabase.from('employee_statutory_enrollment').update(payload).eq('id', statutory.id))
    } else {
      const res = await supabase.from('employee_statutory_enrollment').insert(payload).select('id').single()
      error = res.error
      if (!error && res.data) setStatutory((s) => ({ ...s, id: res.data.id }))
    }
    setSaving(false)
    if (error) toast.error('Could not save statutory settings', { description: error.message })
    else {
      await writeAuditLog({ action: 'UPDATE', entityType: 'employee_statutory', entityId: id })
      toast.success('Statutory enrollment saved')
    }
  }

  if (loading || !employee) {
    return (
      <div className="grid place-items-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const fullName = String(employee.full_name ?? '')
  const code = String(employee.employee_code ?? '')

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex flex-wrap items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/employees')}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <Avatar className="h-12 w-12">
          {employee.photo_url ? (
            <AvatarImage src={employee.photo_url as string} alt={fullName} />
          ) : null}
          <AvatarFallback className={avatarColorFor(code)}>{initialsFromName(fullName)}</AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-[160px]">
          <h2 className="text-xl font-semibold">{fullName}</h2>
          <p className="text-sm text-muted-foreground">{code}</p>
        </div>
        {canDelete && (
          <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)} disabled={saving}>
            <Trash2 className="h-4 w-4" />
            Delete
          </Button>
        )}
      </div>

      <div className="flex gap-1 border-b overflow-x-auto">
        {([
          ['profile', 'Profile'],
          ['statutory', 'Statutory'],
          ['shifts', 'Shifts'],
          ['compensation', 'Compensation'],
          ['bank', 'Bank'],
          ['documents', 'Documents'],
        ] as [Tab, string][]).map(([t, label]) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
              tab === t ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'profile' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Employment</CardTitle>
            <CardDescription>Full edit from the employees list — detail form ships next.</CardDescription>
          </CardHeader>
          <CardContent className="grid sm:grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-muted-foreground">Branch</span>
              <div>{(employee.branches as { name?: string })?.name ?? '—'}</div>
            </div>
            <div>
              <span className="text-muted-foreground">Department</span>
              <div>{(employee.departments as { name?: string })?.name ?? '—'}</div>
            </div>
            <div>
              <span className="text-muted-foreground">Designation</span>
              <div>{(employee.designations as { title?: string })?.title ?? '—'}</div>
            </div>
            <div>
              <span className="text-muted-foreground">Status</span>
              <div>{String(employee.employment_status)}</div>
            </div>
            <div>
              <span className="text-muted-foreground">CNIC</span>
              <div>{String(employee.cnic ?? '—')}</div>
            </div>
            <div>
              <span className="text-muted-foreground">Email</span>
              <div>{String(employee.email ?? '—')}</div>
            </div>
            <div>
              <span className="text-muted-foreground">Device PIN (ZKTeco)</span>
              <div className="font-mono">
                {employee.device_pin != null && Number(employee.device_pin) > 0
                  ? String(employee.device_pin)
                  : '— not set'}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {tab === 'profile' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Attendance devices</CardTitle>
            <CardDescription>
              Punches are matched by Device PIN. The table below shows which registered machine each punch came from.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {recentPunches.length === 0 ? (
              <p className="text-sm text-muted-foreground">No attendance punches imported yet for this employee.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border text-sm">
                <table className="w-full">
                  <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
                    <tr className="text-left">
                      <th className="px-4 py-2 w-10">#</th>
                      <th className="px-3 py-2">Employee</th>
                      <th className="px-3 py-2">Time</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Device</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {recentPunches.map((p, i) => (
                      <tr key={`${p.punch_at}-${i}`}>
                        <td className="px-4 py-2 tabular-nums text-muted-foreground">{i + 1}</td>
                        <td className="px-3 py-2 font-medium">{String(employee.full_name ?? '—')}</td>
                        <td className="px-4 py-2 tabular-nums">
                          {new Date(p.punch_at).toLocaleString('en-PK', {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })}
                        </td>
                        <td className="px-3 py-2 capitalize text-muted-foreground">{p.punch_type}</td>
                        <td className="px-3 py-2">{p.attendance_devices?.name ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {tab === 'statutory' && (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">Statutory enrollment</CardTitle>
              <CardDescription>
                Toggle EOBI, Provident Fund, Social Security, and income tax per employee. Payroll uses these on
                the effective date.
              </CardDescription>
            </div>
            {canUpdate && (
              <Button size="sm" onClick={saveStatutory} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2 max-w-xs">
              <Label>Effective from</Label>
              <Input
                type="date"
                value={statutory.effective_from}
                onChange={(e) => setStatutory({ ...statutory, effective_from: e.target.value })}
                disabled={!canUpdate}
              />
            </div>

            <div className="space-y-4 rounded-lg border p-4">
              <label className="flex items-center gap-2 font-medium">
                <Checkbox
                  checked={statutory.eobi_enabled}
                  onCheckedChange={(v) => setStatutory({ ...statutory, eobi_enabled: !!v })}
                  disabled={!canUpdate}
                />
                EOBI
              </label>
              {statutory.eobi_enabled && (
                <div className="space-y-2 pl-6">
                  <Label className="text-xs">Custom amount (PKR, optional — leave blank for company default)</Label>
                  <Input
                    type="number"
                    value={statutory.eobi_custom_amount}
                    onChange={(e) => setStatutory({ ...statutory, eobi_custom_amount: e.target.value })}
                    disabled={!canUpdate}
                  />
                </div>
              )}
            </div>

            <div className="space-y-4 rounded-lg border p-4">
              <label className="flex items-center gap-2 font-medium">
                <Checkbox
                  checked={statutory.pf_enabled}
                  onCheckedChange={(v) => setStatutory({ ...statutory, pf_enabled: !!v })}
                  disabled={!canUpdate}
                />
                Provident Fund (PF)
              </label>
              {statutory.pf_enabled && (
                <div className="grid sm:grid-cols-2 gap-4 pl-6">
                  <div className="space-y-2">
                    <Label className="text-xs">Employee %</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={statutory.pf_employee_pct}
                      onChange={(e) => setStatutory({ ...statutory, pf_employee_pct: e.target.value })}
                      disabled={!canUpdate}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Employer match %</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={statutory.pf_employer_pct}
                      onChange={(e) => setStatutory({ ...statutory, pf_employer_pct: e.target.value })}
                      disabled={!canUpdate}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-4 rounded-lg border p-4">
              <label className="flex items-center gap-2 font-medium">
                <Checkbox
                  checked={statutory.social_security_enabled}
                  onCheckedChange={(v) => setStatutory({ ...statutory, social_security_enabled: !!v })}
                  disabled={!canUpdate}
                />
                Social Security (SESSI / PESSI)
              </label>
              {statutory.social_security_enabled && (
                <div className="space-y-2 pl-6">
                  <Label className="text-xs">Custom amount (optional)</Label>
                  <Input
                    type="number"
                    value={statutory.social_security_custom_amount}
                    onChange={(e) => setStatutory({ ...statutory, social_security_custom_amount: e.target.value })}
                    disabled={!canUpdate}
                  />
                </div>
              )}
            </div>

            <label className="flex items-center gap-2 text-sm p-4 rounded-lg border">
              <Checkbox
                checked={statutory.income_tax_enabled}
                onCheckedChange={(v) => setStatutory({ ...statutory, income_tax_enabled: !!v })}
                disabled={!canUpdate}
              />
              Apply income tax for this employee (when enabled in Settings)
            </label>
          </CardContent>
        </Card>
      )}

      {tab === 'shifts' && id && <ShiftAssignmentTab employeeId={id} />}
      {tab === 'compensation' && id && <CompensationTab employeeId={id} />}
      {tab === 'bank' && id && <BankTab employeeId={id} employeeName={fullName} />}
      {tab === 'documents' && id && <DocumentsTab employeeId={id} />}

      <DeleteEmployeeDialog
        employee={
          deleteOpen && id && employee
            ? {
                id,
                full_name: String(employee.full_name ?? ''),
                employee_code: String(employee.employee_code ?? ''),
              }
            : null
        }
        onOpenChange={setDeleteOpen}
        onDeleted={() => {
          setDeleteOpen(false)
          navigate('/employees')
        }}
      />
    </div>
  )
}
