import { useEffect, useState, type ReactNode } from 'react'
import { Plus, Pencil, RefreshCw, Loader2, Users, Search, ChevronRight, ArrowLeft, ArrowRight, Check, Camera, X, Trash2, Save, FileSpreadsheet } from 'lucide-react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { writeAuditLog } from '@/lib/audit'
import { findDuplicateForForm } from '@/lib/employeeDuplicateCheck'
import { loadEmployeeDevicePin, syncEmployeeDevicePin } from '@/lib/employeeDevicePin'
import { admsConnectionStatus, lastSeenBadge } from '@/lib/admsDeviceStatus'
import { nextCode } from '@/lib/codegen'
import { EMPLOYMENT_STATUSES, PAY_FREQUENCIES } from '@/lib/constants'
import { PageHeader } from '@/components/master/PageHeader'
import { HasPermission } from '@/components/HasPermission'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { avatarColorFor, cn, initialsFromName, sortByEmployeeCode } from '@/lib/utils'
import { toast } from 'sonner'
import { DocumentsTab } from '@/components/employee/DocumentsTab'
import { DeleteEmployeeDialog } from '@/components/employee/DeleteEmployeeDialog'
import { StaffStatusImportDialog } from '@/components/employee/StaffStatusImportDialog'
import {
  AllowanceToggleField,
  compGrossFromForm,
  defaultAllowanceFlags,
  validateAllowanceForm,
} from '@/components/payroll/AllowanceToggleField'

type Lookup = { id: string; name?: string; title?: string; code?: string }

type ZktDevice = {
  id: string
  name: string
  push_token: string | null
  last_seen_at: string | null
  is_active: boolean
  serial_no: string | null
}

type Employee = {
  id: string
  employee_code: string
  first_name: string
  last_name: string | null
  full_name: string
  email: string | null
  phone: string | null
  cnic: string | null
  employment_status: string
  is_active: boolean
  overtime_eligible: boolean
  photo_url: string | null
  branch_id: string | null
  department_id: string | null
  designation_id: string | null
  branches?: { name: string } | null
  departments?: { name: string } | null
  designations?: { title: string } | null
  device_pin: number | null
}

const emptyForm = {
  employee_code: '',
  first_name: '',
  last_name: '',
  email: '',
  phone: '',
  cnic: '',
  gender: '',
  date_of_birth: '',
  date_of_joining: '',
  employment_status: 'Active',
  branch_id: '',
  department_id: '',
  designation_id: '',
  reports_to_id: '',
  device_pin: '',
  attendance_device_id: '',
  shift_id: '',
  is_active: true,
  overtime_eligible: true,
}

const today = () => new Date().toISOString().slice(0, 10)

const emptyComp = {
  effective_from: today(),
  basic: 0,
  house_rent: 0,
  medical: 0,
  conveyance: 0,
  utilities: 0,
  other_allowances: 0,
  pay_frequency: 'Monthly',
  currency: 'PKR',
  revision_reason: 'Joining',
  ...defaultAllowanceFlags(),
}

const emptyStatutory = {
  effective_from: today(),
  eobi_enabled: false,
  eobi_custom_amount: '',
  pf_enabled: false,
  pf_employee_pct: '',
  pf_employer_pct: '',
  social_security_enabled: false,
  social_security_custom_amount: '',
  income_tax_enabled: false,
}

type Step = 1 | 2 | 3 | 4

const STEP_LABELS: { id: Step; label: string }[] = [
  { id: 1, label: 'Profile' },
  { id: 2, label: 'Compensation' },
  { id: 3, label: 'Statutory' },
  { id: 4, label: 'Documents' },
]

const pkr = (n: number) => `PKR ${Number(n).toLocaleString('en-PK', { maximumFractionDigits: 0 })}`

function validateProfile(form: typeof emptyForm): string | null {
  if (!form.branch_id) return 'Branch is required'
  if (!form.department_id) return 'Department is required'
  if (!form.designation_id) return 'Designation is required'
  if (!form.date_of_joining) return 'Date of joining is required'
  if (!form.first_name.trim()) return 'First name is required'
  if (!form.last_name.trim()) return 'Last name is required'
  if (!form.cnic.trim()) return 'CNIC is required'
  return null
}

function validateComp(comp: typeof emptyComp): string | null {
  if (!comp.effective_from) return 'Effective from is required'
  if (!comp.pay_frequency) return 'Pay frequency is required'
  if (comp.basic <= 0) return 'Basic salary is required (must be greater than 0)'
  return validateAllowanceForm(comp)
}

export function EmployeesPage() {
  const navigate = useNavigate()
  const { appUser, hasPermission } = useAuth()
  const canCreate = hasPermission('employee.create')
  const canUpdate = hasPermission('employee.update')
  const canDelete = hasPermission('employee.delete')
  const canSetSalary = hasPermission('payroll.salary') || hasPermission('payroll.config')
  const canAssignShift = hasPermission('shift.assign')
  const [rows, setRows] = useState<Employee[]>([])
  const [branches, setBranches] = useState<Lookup[]>([])
  const [departments, setDepartments] = useState<Lookup[]>([])
  const [designations, setDesignations] = useState<Lookup[]>([])
  const [shifts, setShifts] = useState<Lookup[]>([])
  const [managers, setManagers] = useState<Lookup[]>([])
  const [zktDevices, setZktDevices] = useState<ZktDevice[]>([])
  const [selectedDeviceCloud, setSelectedDeviceCloud] = useState<{
    device: ZktDevice
    lastPunchAt: string | null
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Employee | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [comp, setComp] = useState(emptyComp)
  const [statutory, setStatutory] = useState(emptyStatutory)
  const [busy, setBusy] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Employee | null>(null)
  const [step, setStep] = useState<Step>(1)
  const [createdId, setCreatedId] = useState<string | null>(null)
  const [compRecordId, setCompRecordId] = useState<string | null>(null)
  const [statutoryRecordId, setStatutoryRecordId] = useState<string | null>(null)
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [existingPhotoUrl, setExistingPhotoUrl] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)

  async function loadLookups() {
    const [b, d, des, sh, emp, dev] = await Promise.all([
      supabase.from('branches').select('id, name').eq('is_active', true).order('name'),
      supabase.from('departments').select('id, name').eq('is_active', true).order('name'),
      supabase.from('designations').select('id, title').eq('is_active', true).order('title'),
      supabase.from('shifts').select('id, code, name').eq('is_active', true).order('name'),
      supabase.from('employees').select('id, full_name, employee_code').eq('is_active', true).order('full_name'),
      supabase
        .from('attendance_devices')
        .select('id, name, push_token, last_seen_at, is_active, serial_no')
        .eq('device_type', 'ZKTeco')
        .eq('is_active', true)
        .order('name'),
    ])
    setBranches((b.data ?? []).map((x) => ({ id: x.id, name: x.name })))
    setDepartments((d.data ?? []).map((x) => ({ id: x.id, name: x.name })))
    setDesignations((des.data ?? []).map((x) => ({ id: x.id, title: x.title })))
    setShifts(
      (sh.data ?? []).map((x) => ({
        id: x.id,
        name: `${x.code} — ${x.name}`,
      }))
    )
    setManagers((emp.data ?? []).map((x) => ({ id: x.id, name: `${x.full_name} (${x.employee_code})` })))
    setZktDevices((dev.data ?? []) as ZktDevice[])
  }

  useEffect(() => {
    if (!open || !form.attendance_device_id) {
      setSelectedDeviceCloud(null)
      return
    }
    const deviceId = form.attendance_device_id
    void (async () => {
      const [{ data: dev }, { data: punch }] = await Promise.all([
        supabase
          .from('attendance_devices')
          .select('id, name, push_token, last_seen_at, is_active, serial_no')
          .eq('id', deviceId)
          .single(),
        supabase
          .from('attendance_punches')
          .select('punch_at')
          .eq('device_id', deviceId)
          .eq('source', 'zkteco')
          .order('punch_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ])
      if (dev) {
        setSelectedDeviceCloud({ device: dev as ZktDevice, lastPunchAt: punch?.punch_at ?? null })
      }
    })()
  }, [open, form.attendance_device_id])

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('employees')
      .select(
        `id, employee_code, first_name, last_name, full_name, email, phone, cnic, employment_status, is_active, overtime_eligible, photo_url,
         device_pin, branch_id, department_id, designation_id,
         branches(name), departments(name), designations(title)`
      )
      .order('employee_code')
    if (error) toast.error('Failed to load employees', { description: error.message })
    else {
      const mapped = (data ?? []).map((row: Record<string, unknown>) => {
        const rel = (key: string) => {
          const v = row[key]
          if (Array.isArray(v)) return (v[0] as { name?: string; title?: string }) ?? null
          return (v as { name?: string; title?: string }) ?? null
        }
        return {
          ...(row as object),
          branches: rel('branches'),
          departments: rel('departments'),
          designations: rel('designations'),
        } as Employee
      })
      setRows(sortByEmployeeCode(mapped))
    }
    setLoading(false)
  }

  useEffect(() => {
    void loadLookups()
    void load()
  }, [])

  const filtered = rows.filter((e) => {
    const q = query.toLowerCase().trim()
    if (!q) return true
    return (
      e.employee_code.toLowerCase().includes(q) ||
      e.full_name.toLowerCase().includes(q) ||
      (e.email ?? '').toLowerCase().includes(q) ||
      (e.cnic ?? '').includes(q)
    )
  })

  const resetWizard = () => {
    setStep(1)
    setCreatedId(null)
    setCompRecordId(null)
    setStatutoryRecordId(null)
    setForm(emptyForm)
    setComp(emptyComp)
    setStatutory(emptyStatutory)
    setPhotoFile(null)
    setPhotoPreview(null)
    setExistingPhotoUrl(null)
  }

  const activeEmployeeId = editing?.id ?? createdId

  const onPhotoChange = (file: File | null) => {
    setPhotoFile(file)
    if (photoPreview) URL.revokeObjectURL(photoPreview)
    setPhotoPreview(file ? URL.createObjectURL(file) : null)
  }

  // Upload a photo and return the public URL, or null on failure
  const uploadPhoto = async (employeeId: string): Promise<string | null> => {
    if (!photoFile) return null
    const ext = (photoFile.name.split('.').pop() ?? 'jpg').toLowerCase()
    const path = `${employeeId}/${Date.now()}.${ext}`
    const { error } = await supabase.storage
      .from('employee-photos')
      .upload(path, photoFile, { upsert: true, contentType: photoFile.type })
    if (error) {
      toast.error('Photo upload failed', { description: error.message })
      return null
    }
    const { data } = supabase.storage.from('employee-photos').getPublicUrl(path)
    return data.publicUrl
  }

  const openCreate = async () => {
    setEditing(null)
    resetWizard()
    const employee_code = await nextCode({
      table: 'employees',
      column: 'employee_code',
      prefix: 'EMP-',
      width: 4,
      companyId: appUser?.company_id,
    })
    setForm({ ...emptyForm, employee_code })
    setOpen(true)
  }

  const openEdit = async (e: Employee) => {
    setEditing(e)
    setStep(1)
    setCreatedId(null)
    setCompRecordId(null)
    setStatutoryRecordId(null)
    setPhotoFile(null)
    setPhotoPreview(null)
    setExistingPhotoUrl(e.photo_url)
    setComp(emptyComp)
    setStatutory(emptyStatutory)

    const [{ data: full }, { data: sal }, { data: stat }, { data: shiftRow }] = await Promise.all([
      supabase
        .from('employees')
        .select('*, reports_to_id, gender, date_of_birth, date_of_joining')
        .eq('id', e.id)
        .single(),
      supabase
        .from('employee_salary_history')
        .select('*')
        .eq('employee_id', e.id)
        .order('effective_from', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('employee_statutory_enrollment')
        .select('*')
        .eq('employee_id', e.id)
        .order('effective_from', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('employee_shift_assignments')
        .select('shift_id')
        .eq('employee_id', e.id)
        .is('effective_to', null)
        .order('effective_from', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    const row = (full ?? e) as Record<string, unknown>
    setForm({
      employee_code: e.employee_code,
      first_name: e.first_name,
      last_name: e.last_name ?? '',
      email: e.email ?? '',
      phone: e.phone ?? '',
      cnic: e.cnic ?? '',
      gender: String(row.gender ?? ''),
      date_of_birth: row.date_of_birth ? String(row.date_of_birth).slice(0, 10) : '',
      date_of_joining: row.date_of_joining ? String(row.date_of_joining).slice(0, 10) : '',
      employment_status: e.employment_status,
      branch_id: row.branch_id ? String(row.branch_id) : e.branch_id ?? '',
      department_id: row.department_id ? String(row.department_id) : e.department_id ?? '',
      designation_id: row.designation_id ? String(row.designation_id) : e.designation_id ?? '',
      reports_to_id: row.reports_to_id ? String(row.reports_to_id) : '',
      device_pin: row.device_pin != null ? String(row.device_pin) : '',
      attendance_device_id: '',
      shift_id: shiftRow?.shift_id ? String(shiftRow.shift_id) : '',
      is_active: e.is_active,
      overtime_eligible: row.overtime_eligible !== false,
    })

    try {
      const mapping = await loadEmployeeDevicePin(e.id, appUser?.company_id)
      if (mapping.device_id) {
        setForm((f) => ({
          ...f,
          attendance_device_id: mapping.device_id!,
          device_pin: mapping.device_pin != null ? String(mapping.device_pin) : f.device_pin,
        }))
      }
    } catch {
      /* table may not exist until migration 0036 */
    }

    if (sal) {
      setCompRecordId(sal.id)
      setComp({
        effective_from: sal.effective_from,
        basic: +sal.basic,
        house_rent: +sal.house_rent,
        medical: +sal.medical,
        conveyance: +sal.conveyance,
        utilities: +sal.utilities,
        other_allowances: +sal.other_allowances,
        pay_frequency: sal.pay_frequency,
        currency: sal.currency,
        revision_reason: sal.revision_reason ?? '',
        house_rent_enabled: sal.house_rent_enabled === true,
        medical_enabled: sal.medical_enabled === true,
        conveyance_enabled: sal.conveyance_enabled === true,
        utilities_enabled: sal.utilities_enabled === true,
        other_allowances_enabled: sal.other_allowances_enabled === true,
      })
    }

    if (stat) {
      setStatutoryRecordId(stat.id)
      setStatutory({
        effective_from: stat.effective_from,
        eobi_enabled: stat.eobi_enabled,
        eobi_custom_amount: stat.eobi_custom_amount?.toString() ?? '',
        pf_enabled: stat.pf_enabled,
        pf_employee_pct: stat.pf_employee_pct?.toString() ?? '',
        pf_employer_pct: stat.pf_employer_pct?.toString() ?? '',
        social_security_enabled: stat.social_security_enabled,
        social_security_custom_amount: stat.social_security_custom_amount?.toString() ?? '',
        income_tax_enabled: stat.income_tax_enabled === true,
      })
    }

    setOpen(true)
  }

  const syncEmployeeShift = async (employeeId: string): Promise<boolean> => {
    if (!canAssignShift || !form.shift_id) return true
    const effectiveFrom = form.date_of_joining || today()
    const { data: existing } = await supabase
      .from('employee_shift_assignments')
      .select('id, shift_id')
      .eq('employee_id', employeeId)
      .is('effective_to', null)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existing?.shift_id === form.shift_id) return true

    if (existing?.id) {
      const { error } = await supabase
        .from('employee_shift_assignments')
        .update({ shift_id: form.shift_id })
        .eq('id', existing.id)
      if (error) {
        toast.error('Shift assignment failed', { description: error.message })
        return false
      }
      await writeAuditLog({
        action: 'UPDATE',
        entityType: 'employee_shift_assignment',
        entityId: existing.id,
        after: { shift_id: form.shift_id },
      })
      return true
    }

    const payload = {
      employee_id: employeeId,
      shift_id: form.shift_id,
      effective_from: effectiveFrom,
      effective_to: null,
      weekly_off: ['Sunday'],
      notes: null,
    }
    const { data, error } = await supabase
      .from('employee_shift_assignments')
      .insert(payload)
      .select('id')
      .single()
    if (error) {
      toast.error('Shift assignment failed', { description: error.message })
      return false
    }
    await writeAuditLog({
      action: 'CREATE',
      entityType: 'employee_shift_assignment',
      entityId: data?.id,
      after: payload,
    })
    return true
  }

  // STEP 1 — save profile
  const saveProfileStep = async (): Promise<boolean> => {
    if (!appUser) return false
    const err = validateProfile(form)
    if (err) {
      toast.error(err)
      return false
    }
    setBusy(true)
    const payload = {
      company_id: appUser.company_id,
      employee_code: form.employee_code.trim(),
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      cnic: form.cnic.trim() || null,
      gender: form.gender || null,
      date_of_birth: form.date_of_birth || null,
      date_of_joining: form.date_of_joining,
      employment_status: form.employment_status,
      branch_id: form.branch_id,
      department_id: form.department_id,
      designation_id: form.designation_id,
      reports_to_id: form.reports_to_id || null,
      device_pin: form.device_pin.trim() ? parseInt(form.device_pin, 10) : null,
      is_active: form.is_active,
      overtime_eligible: form.overtime_eligible,
    }

    if (editing) {
      const pin = form.device_pin.trim() ? parseInt(form.device_pin, 10) : null
      const dup = await findDuplicateForForm({
        companyId: appUser.company_id,
        cnic: form.cnic.trim(),
        devicePin: pin,
        firstName: form.first_name.trim(),
        lastName: form.last_name.trim(),
        excludeEmployeeId: editing.id,
      })
      if (dup) {
        setBusy(false)
        toast.error('Duplicate employee', { description: dup.label })
        return false
      }

      let nextPhoto: string | null | undefined = undefined
      if (photoFile) nextPhoto = await uploadPhoto(editing.id)
      else if (existingPhotoUrl === null) nextPhoto = null // user removed photo

      const { error } = await supabase
        .from('employees')
        .update({ ...payload, ...(nextPhoto !== undefined ? { photo_url: nextPhoto } : {}) })
        .eq('id', editing.id)
      if (error) {
        setBusy(false)
        toast.error('Update failed', { description: error.message })
        return false
      }
      try {
        const pin = form.device_pin.trim() ? parseInt(form.device_pin, 10) : null
        const mapResult = await syncEmployeeDevicePin(
          editing.id,
          appUser.company_id,
          form.attendance_device_id || null,
          pin
        )
        setBusy(false)
        await writeAuditLog({ action: 'UPDATE', entityType: 'employee', entityId: editing.id })
        const shiftOk = await syncEmployeeShift(editing.id)
        if (!shiftOk) return false
        if (mapResult.usedFallback) {
          toast.success('Profile saved — device + PIN linked', {
            description: 'Device PIN saved for ADMS attendance import.',
          })
        } else {
          toast.success('Profile saved', {
            description:
              form.attendance_device_id && form.device_pin.trim()
                ? 'Employee linked to device and PIN.'
                : undefined,
          })
        }
        void load()
        return true
      } catch (mapErr) {
        setBusy(false)
        toast.error('Device mapping failed', {
          description: mapErr instanceof Error ? mapErr.message : 'Could not save per-device PIN',
        })
        return false
      }
    } else {
      const pin = form.device_pin.trim() ? parseInt(form.device_pin, 10) : null
      const dup = await findDuplicateForForm({
        companyId: appUser.company_id,
        cnic: form.cnic.trim(),
        devicePin: pin,
        firstName: form.first_name.trim(),
        lastName: form.last_name.trim(),
      })
      if (dup) {
        setBusy(false)
        toast.error('Duplicate employee', { description: dup.label })
        return false
      }

      const { data, error } = await supabase.from('employees').insert(payload).select('id').single()
      if (error || !data) {
        setBusy(false)
        toast.error('Create failed', { description: error?.message })
        return false
      }
      // Upload photo if provided, then patch the row
      if (photoFile) {
        const photo_url = await uploadPhoto(data.id)
        if (photo_url) {
          await supabase.from('employees').update({ photo_url }).eq('id', data.id)
        }
      }
      try {
        const pin = form.device_pin.trim() ? parseInt(form.device_pin, 10) : null
        const mapResult = await syncEmployeeDevicePin(
          data.id,
          appUser.company_id,
          form.attendance_device_id || null,
          pin
        )
        if (mapResult.usedFallback) {
          toast.success('Profile saved — device + PIN linked', {
            description: 'Device PIN saved for ADMS attendance import.',
          })
        }
      } catch (mapErr) {
        setBusy(false)
        toast.error('Device mapping failed', {
          description: mapErr instanceof Error ? mapErr.message : 'Could not save per-device PIN',
        })
        return false
      }
      setBusy(false)
      await writeAuditLog({ action: 'CREATE', entityType: 'employee', entityId: data.id })
      const shiftOk = await syncEmployeeShift(data.id)
      if (!shiftOk) return false
      toast.success('Profile saved')
      setCreatedId(data.id)
      void loadLookups()
      return true
    }
  }

  // STEP 2 — save compensation (required when user has salary permission)
  const saveCompStep = async (): Promise<boolean> => {
    const empId = activeEmployeeId
    if (!empId) return false
    if (!canSetSalary) return true
    const err = validateComp(comp)
    if (err) {
      toast.error(err)
      return false
    }
    setBusy(true)
    const payload = {
      employee_id: empId,
      effective_from: comp.effective_from,
      effective_to: null,
      basic: +comp.basic,
      house_rent: +comp.house_rent,
      medical: +comp.medical,
      conveyance: +comp.conveyance,
      utilities: +comp.utilities,
      other_allowances: +comp.other_allowances,
      pay_frequency: comp.pay_frequency,
      currency: comp.currency,
      revision_reason: comp.revision_reason.trim() || null,
      house_rent_enabled: comp.house_rent_enabled,
      medical_enabled: comp.medical_enabled,
      conveyance_enabled: comp.conveyance_enabled,
      utilities_enabled: comp.utilities_enabled,
      other_allowances_enabled: comp.other_allowances_enabled,
    }
    if (compRecordId) {
      const { error } = await supabase.from('employee_salary_history').update(payload).eq('id', compRecordId)
      setBusy(false)
      if (error) {
        toast.error('Compensation save failed', { description: error.message })
        return false
      }
      await writeAuditLog({ action: 'UPDATE', entityType: 'employee_salary_history', entityId: compRecordId, after: payload })
    } else {
      const { data, error } = await supabase.from('employee_salary_history').insert(payload).select('id').single()
      setBusy(false)
      if (error) {
        toast.error('Compensation save failed', { description: error.message })
        return false
      }
      setCompRecordId(data?.id ?? null)
      await writeAuditLog({ action: 'CREATE', entityType: 'employee_salary_history', entityId: data?.id, after: payload })
    }
    toast.success('Compensation saved')
    return true
  }

  // STEP 3 — save statutory (always persist, including when all toggles are off)
  const saveStatutoryStep = async (): Promise<boolean> => {
    const empId = activeEmployeeId
    if (!empId) return false
    setBusy(true)
    const payload = {
      employee_id: empId,
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
    if (statutoryRecordId) {
      const { error } = await supabase.from('employee_statutory_enrollment').update(payload).eq('id', statutoryRecordId)
      setBusy(false)
      if (error) {
        toast.error('Statutory save failed', { description: error.message })
        return false
      }
      await writeAuditLog({ action: 'UPDATE', entityType: 'employee_statutory', entityId: statutoryRecordId, after: payload })
    } else {
      const { data, error } = await supabase.from('employee_statutory_enrollment').insert(payload).select('id').single()
      setBusy(false)
      if (error) {
        toast.error('Statutory save failed', { description: error.message })
        return false
      }
      setStatutoryRecordId(data?.id ?? null)
      await writeAuditLog({ action: 'CREATE', entityType: 'employee_statutory', entityId: data?.id, after: payload })
    }
    toast.success('Statutory enrollment saved')
    return true
  }

  const goNext = async () => {
    if (step === 1) {
      const ok = await saveProfileStep()
      if (!ok) return
      setStep(2)
    } else if (step === 2) {
      const ok = await saveCompStep()
      if (!ok) return
      setStep(3)
    } else if (step === 3) {
      const ok = await saveStatutoryStep()
      if (!ok) return
      setStep(4)
    } else {
      toast.success(editing ? 'Employee saved' : 'Employee onboarding complete')
      setOpen(false)
      setEditing(null)
      resetWizard()
      void load()
    }
  }

  const goBack = () => {
    if (step > 1) setStep((s) => (s - 1) as Step)
  }

  const goSkip = () => {
    if (step === 3) setStep(4)
    else if (step === 4) {
      setOpen(false)
      void load()
    }
  }

  const compGross = compGrossFromForm(+comp.basic, comp)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Employees"
        description="Employee master records — full lifecycle: profile, salary, statutory, documents."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
            <HasPermission perm="employee.create">
              <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
                <FileSpreadsheet className="h-4 w-4" /> Import Excel
              </Button>
              <Button size="sm" onClick={() => void openCreate()}>
                <Plus className="h-4 w-4" /> Add employee
              </Button>
            </HasPermission>
          </>
        }
      />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base">All employees</CardTitle>
            <CardDescription>{filtered.length} shown</CardDescription>
          </div>
          <div className="relative w-72 max-w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search code, name, CNIC…" className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-12 grid place-items-center">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center">
              <Users className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No employees yet — add your first team member.</p>
              {canCreate && (
                <Button size="sm" className="mt-4" onClick={() => void openCreate()}>
                  <Plus className="h-4 w-4" /> Add employee
                </Button>
              )}
            </div>
          ) : (
            <div className="divide-y">
              {filtered.map((e) => (
                <div key={e.id} className="flex flex-wrap items-center gap-4 px-6 py-4 hover:bg-muted/30">
                  <Avatar className="h-10 w-10">
                    {e.photo_url && <AvatarImage src={e.photo_url} alt={e.full_name} />}
                    <AvatarFallback className={avatarColorFor(e.employee_code)}>
                      {initialsFromName(e.full_name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-[200px]">
                    <div className="font-medium">{e.full_name}</div>
                    <div className="text-sm text-muted-foreground">
                      {e.employee_code}
                      {e.designations?.title && ` · ${e.designations.title}`}
                    </div>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {e.branches?.name ?? '—'} / {e.departments?.name ?? '—'}
                  </div>
                  <div className="text-xs shrink-0 w-20 text-center">
                    {e.device_pin != null && e.device_pin > 0 ? (
                      <span className="font-mono" title="ZKTeco device user ID">
                        PIN {e.device_pin}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/70 italic">No PIN</span>
                    )}
                  </div>
                  <Badge variant={e.employment_status === 'Active' ? 'success' : 'secondary'}>{e.employment_status}</Badge>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="sm" title="Open profile" onClick={() => navigate(`/employees/${e.id}`)}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                    {canUpdate && (
                      <Button variant="ghost" size="sm" title="Edit employee" onClick={() => void openEdit(e)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                    {canDelete && (
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Delete employee"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => setDeleteTarget(e)}
                        disabled={busy}
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

      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o) {
            setOpen(false)
            setEditing(null)
            resetWizard()
            void load()
          }
        }}
      >
        <DialogContent className="sm:max-w-3xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit employee' : 'New employee — onboarding'}</DialogTitle>
            <DialogDescription>
              {editing
                ? 'Update profile, compensation, statutory, and documents step by step.'
                : 'Complete each step. Branch, department, designation, joining date, and compensation are required.'}
            </DialogDescription>
          </DialogHeader>

          {/* Stepper */}
          <div className="flex items-center gap-2 pb-2">
              {STEP_LABELS.map((s, idx) => {
                const reached = step >= s.id
                const done = step > s.id
                return (
                  <div key={s.id} className="flex items-center flex-1">
                    <div className="flex items-center gap-2">
                      <div
                        className={cn(
                          'h-7 w-7 rounded-full grid place-items-center text-xs font-semibold border transition-colors',
                          done
                            ? 'bg-primary text-primary-foreground border-primary'
                            : reached
                              ? 'bg-primary/10 text-primary border-primary'
                              : 'bg-muted text-muted-foreground border-border'
                        )}
                      >
                        {done ? <Check className="h-3.5 w-3.5" /> : s.id}
                      </div>
                      <span className={cn('text-xs', reached ? 'text-foreground font-medium' : 'text-muted-foreground')}>
                        {s.label}
                      </span>
                    </div>
                    {idx < STEP_LABELS.length - 1 && (
                      <div className={cn('h-px flex-1 mx-2', step > s.id ? 'bg-primary' : 'bg-border')} />
                    )}
                  </div>
                )
              })}
          </div>

          {/* Step 1 — Profile */}
          {step === 1 && (
            <form
              id="employee-profile-step"
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                void goNext()
              }}
            >
              {/* Photo upload */}
              <div className="flex items-center gap-4 p-4 border rounded-lg bg-muted/20">
                <Avatar className="h-20 w-20">
                  {(photoPreview || existingPhotoUrl) && (
                    <AvatarImage src={(photoPreview || existingPhotoUrl) as string} alt="Employee photo" />
                  )}
                  <AvatarFallback className={avatarColorFor(form.employee_code || 'new')}>
                    {form.first_name || form.last_name
                      ? initialsFromName(`${form.first_name} ${form.last_name}`.trim())
                      : '?'}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 space-y-2">
                  <Label className="text-sm">Profile photo</Label>
                  <div className="flex items-center gap-2">
                    <label className="inline-flex items-center gap-2 text-sm px-3 py-1.5 rounded-md border cursor-pointer hover:bg-accent transition-colors">
                      <Camera className="h-3.5 w-3.5" />
                      <span>{photoFile || existingPhotoUrl ? 'Change photo' : 'Upload photo'}</span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/gif,image/webp"
                        className="hidden"
                        onChange={(e) => onPhotoChange(e.target.files?.[0] ?? null)}
                      />
                    </label>
                    {(photoFile || existingPhotoUrl) && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          onPhotoChange(null)
                          setExistingPhotoUrl(null)
                        }}
                      >
                        <X className="h-3.5 w-3.5" /> Remove
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">JPG, PNG, GIF or WebP. Max 5 MB.</p>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Employee code</Label>
                  <Input value={form.employee_code} readOnly disabled className="font-mono" />
                  <p className="text-xs text-muted-foreground">
                    {editing ? 'Codes are immutable.' : 'Auto-generated.'}
                  </p>
                </div>
                <RequiredField label="Status">
                  <Select
                    required
                    value={form.employment_status}
                    onChange={(e) => setForm({ ...form, employment_status: e.target.value })}
                  >
                    {EMPLOYMENT_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </Select>
                </RequiredField>

                <RequiredField label="First name">
                  <Input
                    value={form.first_name}
                    onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                    required
                  />
                </RequiredField>
                <RequiredField label="Last name">
                  <Input
                    value={form.last_name}
                    onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                    required
                  />
                </RequiredField>

                <RequiredField label="Branch">
                  <Select
                    required
                    value={form.branch_id}
                    onChange={(e) => setForm({ ...form, branch_id: e.target.value })}
                  >
                    <option value="">Select branch…</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </Select>
                </RequiredField>
                <RequiredField label="Department">
                  <Select
                    required
                    value={form.department_id}
                    onChange={(e) => setForm({ ...form, department_id: e.target.value })}
                  >
                    <option value="">Select department…</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </Select>
                </RequiredField>

                <RequiredField label="Designation">
                  <Select
                    required
                    value={form.designation_id}
                    onChange={(e) => setForm({ ...form, designation_id: e.target.value })}
                  >
                    <option value="">Select designation…</option>
                    {designations.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title}
                      </option>
                    ))}
                  </Select>
                </RequiredField>
                <RequiredField label="Date of joining">
                  <Input
                    type="date"
                    value={form.date_of_joining}
                    onChange={(e) => setForm({ ...form, date_of_joining: e.target.value })}
                    required
                  />
                </RequiredField>

                <RequiredField label="CNIC">
                  <Input
                    value={form.cnic}
                    onChange={(e) => setForm({ ...form, cnic: e.target.value })}
                    placeholder="35201-1234567-1"
                    required
                  />
                </RequiredField>
                <div className="space-y-2">
                  <Label>Phone</Label>
                  <Input
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Shift</Label>
                  <Select
                    value={form.shift_id}
                    onChange={(e) => setForm({ ...form, shift_id: e.target.value })}
                    disabled={!canAssignShift}
                  >
                    <option value="">Select shift…</option>
                    {shifts.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                  {!canAssignShift && (
                    <p className="text-xs text-muted-foreground">Ask an admin with shift assign permission.</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Date of birth</Label>
                  <Input
                    type="date"
                    value={form.date_of_birth}
                    onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>ZKTeco device (machine)</Label>
                  <Select
                    value={form.attendance_device_id}
                    onChange={(e) => setForm({ ...form, attendance_device_id: e.target.value })}
                  >
                    <option value="">— Not on biometric device —</option>
                    {zktDevices.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Link this employee to a ZKTeco terminal. ADMS push matches the PIN on the device to this
                    employee in HRM.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Device PIN (user ID on that machine)</Label>
                  <Input
                    type="number"
                    min={1}
                    value={form.device_pin}
                    onChange={(e) => setForm({ ...form, device_pin: e.target.value })}
                    placeholder="Same as ZKTime user ID"
                    className="font-mono"
                    disabled={!form.attendance_device_id}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Reports to</Label>
                  <Select value={form.reports_to_id} onChange={(e) => setForm({ ...form, reports_to_id: e.target.value })}>
                    <option value="">None</option>
                    {managers.filter((m) => m.id !== editing?.id).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </Select>
                </div>

                {selectedDeviceCloud && (
                  <div className="sm:col-span-2 rounded-md border bg-muted/30 p-3 text-sm space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">Cloud link — {selectedDeviceCloud.device.name}</span>
                      {(() => {
                        const adms = admsConnectionStatus(
                          selectedDeviceCloud.device,
                          selectedDeviceCloud.lastPunchAt,
                        )
                        const seen = lastSeenBadge(selectedDeviceCloud.device.last_seen_at)
                        return (
                          <>
                            <Badge variant={adms.variant}>{adms.label}</Badge>
                            <Badge variant={seen.variant}>Handshake {seen.label}</Badge>
                          </>
                        )
                      })()}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {admsConnectionStatus(
                        selectedDeviceCloud.device,
                        selectedDeviceCloud.lastPunchAt,
                      ).detail}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      PIN {form.device_pin || '—'} must match the user ID on the terminal. Punches only import when
                      the device is Online and ADMS fields are correct on the MB460.
                    </p>
                    <Link to="/admin/devices" className="text-xs text-primary underline-offset-4 hover:underline">
                      Device troubleshooting →
                    </Link>
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: !!v })} />
                  Active
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox
                    checked={form.overtime_eligible}
                    onCheckedChange={(v) => setForm({ ...form, overtime_eligible: !!v })}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium">Eligible for overtime</span>
                    <span className="block text-xs text-muted-foreground">
                      If unchecked, automatic overtime from attendance will not be created for this employee.
                    </span>
                  </span>
                </label>
              </div>
            </form>
          )}

          {/* Step 2 — Compensation */}
          {step === 2 && (
            <div className="space-y-4">
              {!canSetSalary && (
                <div className="text-xs rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 text-amber-900 dark:text-amber-300 p-3">
                  You don't have <code className="font-mono">payroll.salary</code> permission. Ask a payroll administrator
                  to add compensation after onboarding.
                </div>
              )}
              <div className="grid sm:grid-cols-3 gap-4">
                <RequiredField label="Effective from">
                  <Input
                    type="date"
                    value={comp.effective_from}
                    onChange={(e) => setComp({ ...comp, effective_from: e.target.value })}
                    disabled={!canSetSalary}
                    required
                  />
                </RequiredField>
                <RequiredField label="Pay frequency">
                  <Select
                    required
                    value={comp.pay_frequency}
                    onChange={(e) => setComp({ ...comp, pay_frequency: e.target.value })}
                    disabled={!canSetSalary}
                  >
                    {PAY_FREQUENCIES.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </Select>
                </RequiredField>
                <div className="space-y-2">
                  <Label>Currency</Label>
                  <Input
                    value={comp.currency}
                    onChange={(e) => setComp({ ...comp, currency: e.target.value.toUpperCase() })}
                    maxLength={3}
                    disabled={!canSetSalary}
                  />
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <MoneyField label="Basic" value={comp.basic} onChange={(v) => setComp({ ...comp, basic: v })} disabled={!canSetSalary} required />
                <AllowanceToggleField
                  label="House rent allowance"
                  enabled={comp.house_rent_enabled}
                  amount={comp.house_rent}
                  onEnabledChange={(v) => setComp({ ...comp, house_rent_enabled: v })}
                  onAmountChange={(v) => setComp({ ...comp, house_rent: v })}
                  disabled={!canSetSalary}
                />
                <AllowanceToggleField
                  label="Medical allowance"
                  enabled={comp.medical_enabled}
                  amount={comp.medical}
                  onEnabledChange={(v) => setComp({ ...comp, medical_enabled: v })}
                  onAmountChange={(v) => setComp({ ...comp, medical: v })}
                  disabled={!canSetSalary}
                />
                <AllowanceToggleField
                  label="Conveyance allowance"
                  enabled={comp.conveyance_enabled}
                  amount={comp.conveyance}
                  onEnabledChange={(v) => setComp({ ...comp, conveyance_enabled: v })}
                  onAmountChange={(v) => setComp({ ...comp, conveyance: v })}
                  disabled={!canSetSalary}
                />
                <AllowanceToggleField
                  label="Utilities allowance"
                  enabled={comp.utilities_enabled}
                  amount={comp.utilities}
                  onEnabledChange={(v) => setComp({ ...comp, utilities_enabled: v })}
                  onAmountChange={(v) => setComp({ ...comp, utilities: v })}
                  disabled={!canSetSalary}
                />
                <AllowanceToggleField
                  label="Other allowances / incentive"
                  enabled={comp.other_allowances_enabled}
                  amount={comp.other_allowances}
                  onEnabledChange={(v) => setComp({ ...comp, other_allowances_enabled: v })}
                  onAmountChange={(v) => setComp({ ...comp, other_allowances: v })}
                  disabled={!canSetSalary}
                />
              </div>
              <div className="flex items-center justify-between p-3 rounded-md bg-primary/5 border border-primary/20 text-sm">
                <span className="font-medium text-muted-foreground">Gross ({comp.pay_frequency})</span>
                <span className="text-lg font-semibold tabular-nums">{pkr(compGross)}</span>
              </div>
              <div className="space-y-2">
                <Label>Revision reason</Label>
                <Input
                  value={comp.revision_reason}
                  onChange={(e) => setComp({ ...comp, revision_reason: e.target.value })}
                  disabled={!canSetSalary}
                />
              </div>
            </div>
          )}

          {/* Step 3 — Statutory */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="space-y-2 max-w-xs">
                <Label>Effective from</Label>
                <Input
                  type="date"
                  value={statutory.effective_from}
                  onChange={(e) => setStatutory({ ...statutory, effective_from: e.target.value })}
                />
              </div>

              <div className="space-y-3 rounded-lg border p-4">
                <label className="flex items-center gap-2 font-medium">
                  <Checkbox
                    checked={statutory.eobi_enabled}
                    onCheckedChange={(v) => setStatutory({ ...statutory, eobi_enabled: !!v })}
                  />
                  EOBI (Employees' Old-Age Benefits)
                </label>
                {statutory.eobi_enabled && (
                  <div className="space-y-2 pl-6">
                    <Label className="text-xs">Custom amount (PKR, optional — leave blank for company default)</Label>
                    <Input
                      type="number"
                      value={statutory.eobi_custom_amount}
                      onChange={(e) => setStatutory({ ...statutory, eobi_custom_amount: e.target.value })}
                    />
                  </div>
                )}
              </div>

              <div className="space-y-3 rounded-lg border p-4">
                <label className="flex items-center gap-2 font-medium">
                  <Checkbox
                    checked={statutory.pf_enabled}
                    onCheckedChange={(v) => setStatutory({ ...statutory, pf_enabled: !!v })}
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
                        placeholder="e.g. 8.33"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Employer %</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={statutory.pf_employer_pct}
                        onChange={(e) => setStatutory({ ...statutory, pf_employer_pct: e.target.value })}
                        placeholder="e.g. 8.33"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-3 rounded-lg border p-4">
                <label className="flex items-center gap-2 font-medium">
                  <Checkbox
                    checked={statutory.social_security_enabled}
                    onCheckedChange={(v) => setStatutory({ ...statutory, social_security_enabled: !!v })}
                  />
                  Social Security
                </label>
                {statutory.social_security_enabled && (
                  <div className="space-y-2 pl-6">
                    <Label className="text-xs">Custom amount (PKR, optional)</Label>
                    <Input
                      type="number"
                      value={statutory.social_security_custom_amount}
                      onChange={(e) => setStatutory({ ...statutory, social_security_custom_amount: e.target.value })}
                    />
                  </div>
                )}
              </div>

              <div className="space-y-3 rounded-lg border p-4">
                <label className="flex items-center gap-2 font-medium">
                  <Checkbox
                    checked={statutory.income_tax_enabled}
                    onCheckedChange={(v) => setStatutory({ ...statutory, income_tax_enabled: !!v })}
                  />
                  Income tax withholding
                </label>
                <p className="text-xs text-muted-foreground pl-6">
                  Disable only for non-resident / contract staff. Default is on.
                </p>
              </div>
            </div>
          )}

          {/* Step 4 — Documents */}
          {step === 4 && activeEmployeeId && (
            <div>
              <DocumentsTab employeeId={activeEmployeeId} />
            </div>
          )}

          <DialogFooter className="gap-2 pt-2 sm:justify-between flex-wrap">
            <div>
              {editing && canDelete && (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => setDeleteTarget(editing)}
                  disabled={busy}
                >
                  <Trash2 className="h-4 w-4" /> Delete
                </Button>
              )}
            </div>
            <div className="flex gap-2 ml-auto flex-wrap">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              {step > 1 && (
                <Button type="button" variant="ghost" onClick={goBack} disabled={busy}>
                  <ArrowLeft className="h-4 w-4" /> Back
                </Button>
              )}
              {!editing && step > 1 && step < 4 && step !== 2 && (
                <Button type="button" variant="outline" onClick={goSkip} disabled={busy}>
                  Skip
                </Button>
              )}
              {!editing && step === 2 && !canSetSalary && (
                <Button type="button" variant="outline" onClick={() => setStep(3)} disabled={busy}>
                  Skip
                </Button>
              )}
              {!editing && step === 4 && (
                <Button type="button" variant="outline" onClick={goSkip} disabled={busy}>
                  Skip & finish
                </Button>
              )}
              <Button
                type={step === 1 ? 'submit' : 'button'}
                form={step === 1 ? 'employee-profile-step' : undefined}
                onClick={step === 1 ? undefined : () => void goNext()}
                disabled={busy}
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {step < 4 && (
                  <>
                    Next <ArrowRight className="h-4 w-4" />
                  </>
                )}
                {step === 4 && editing && (
                  <>
                    <Save className="h-4 w-4" /> Save
                  </>
                )}
                {step === 4 && !editing && (
                  <>
                    <Check className="h-4 w-4" /> Finish
                  </>
                )}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <StaffStatusImportDialog open={importOpen} onOpenChange={setImportOpen} onComplete={() => void load()} />

      <DeleteEmployeeDialog
        employee={
          deleteTarget
            ? {
                id: deleteTarget.id,
                full_name: deleteTarget.full_name,
                employee_code: deleteTarget.employee_code,
              }
            : null
        }
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        onDeleted={() => {
          const deletedId = deleteTarget?.id
          setDeleteTarget(null)
          if (editing?.id === deletedId) setOpen(false)
          void load()
        }}
      />
    </div>
  )
}

function RequiredField({
  label,
  children,
  className,
  span,
}: {
  label: string
  children: ReactNode
  className?: string
  span?: 'full'
}) {
  return (
    <div className={cn('space-y-2', span === 'full' && 'sm:col-span-2', className)}>
      <Label>
        {label} <span className="text-destructive">*</span>
      </Label>
      {children}
    </div>
  )
}

function MoneyField({
  label,
  value,
  onChange,
  disabled,
  required,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  disabled?: boolean
  required?: boolean
}) {
  const field = (
    <Input
      type="number"
      min={0}
      step={1}
      value={value}
      onChange={(e) => onChange(+e.target.value || 0)}
      disabled={disabled}
      required={required}
    />
  )

  if (required) {
    return <RequiredField label={label}>{field}</RequiredField>
  }

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {field}
    </div>
  )
}
