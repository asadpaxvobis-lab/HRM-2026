import { supabase } from '@/lib/supabase'
import { nextCode } from '@/lib/codegen'
import { nextDepartmentCode } from '@/lib/departmentCodes'
import { syncEmployeeDevicePin } from '@/lib/employeeDevicePin'
import {
  findDuplicateInList,
  importRowDedupeKey,
  type EmployeeListRow,
} from '@/lib/employeeDuplicateCheck'
import { matchByName, type StaffImportRow } from '@/lib/staffStatusImport'

const DOC_BUCKET = 'employee-documents'
const today = () => new Date().toISOString().slice(0, 10)

type Lookup = { id: string; name?: string; title?: string }
type Device = { id: string; name: string; ip_address: string | null }

export type StaffImportRowResult = {
  row: StaffImportRow
  status: 'created' | 'updated' | 'skipped' | 'duplicate' | 'error'
  message?: string
  employeeId?: string
}

export type StaffImportRunResult = {
  created: number
  updated: number
  skipped: number
  duplicates: number
  errors: number
  rows: StaffImportRowResult[]
}

type ImportOpts = {
  companyId: string
  userId: string
  canSetSalary: boolean
  onProgress?: (done: number, total: number) => void
}

async function ensureBranch(companyId: string, name: string, cache: Map<string, string>, list: Lookup[]): Promise<string> {
  const key = name.trim().toLowerCase()
  if (!key) throw new Error('Branch name missing')
  const hit = cache.get(key)
  if (hit) return hit
  const matched = matchByName(name, list as (Lookup & { id: string })[], 'name')
  if (matched) {
    cache.set(key, matched)
    return matched
  }
  const code = await nextCode({ table: 'branches', column: 'code', prefix: 'BR-', width: 3, companyId })
  const { data, error } = await supabase
    .from('branches')
    .insert({
      company_id: companyId,
      code,
      name: name.trim(),
      weekly_off_days: [0],
      is_active: true,
    })
    .select('id, name')
    .single()
  if (error || !data) throw new Error(`Branch "${name}": ${error?.message ?? 'create failed'}`)
  list.push({ id: data.id, name: data.name })
  cache.set(key, data.id)
  return data.id
}

async function ensureDepartment(
  companyId: string,
  name: string,
  cache: Map<string, string>,
  list: Lookup[]
): Promise<string> {
  const key = name.trim().toLowerCase()
  if (!key) throw new Error('Department name missing')
  const hit = cache.get(key)
  if (hit) return hit
  const matched = matchByName(name, list as (Lookup & { id: string })[], 'name')
  if (matched) {
    cache.set(key, matched)
    return matched
  }
    const code = await nextDepartmentCode(companyId)
  const { data, error } = await supabase
    .from('departments')
    .insert({ company_id: companyId, code, name: name.trim(), is_active: true })
    .select('id, name')
    .single()
  if (error || !data) throw new Error(`Department "${name}": ${error?.message ?? 'create failed'}`)
  list.push({ id: data.id, name: data.name })
  cache.set(key, data.id)
  return data.id
}

async function ensureDesignation(
  companyId: string,
  title: string,
  cache: Map<string, string>,
  list: Lookup[]
): Promise<string> {
  const key = title.trim().toLowerCase()
  if (!key) throw new Error('Designation missing')
  const hit = cache.get(key)
  if (hit) return hit
  const matched = matchByName(title, list as (Lookup & { id: string })[], 'title')
  if (matched) {
    cache.set(key, matched)
    return matched
  }
  const code = await nextCode({ table: 'designations', column: 'code', prefix: 'DES-', width: 3, companyId })
  const { data, error } = await supabase
    .from('designations')
    .insert({ company_id: companyId, code, title: title.trim(), is_active: true })
    .select('id, title')
    .single()
  if (error || !data) throw new Error(`Designation "${title}": ${error?.message ?? 'create failed'}`)
  list.push({ id: data.id, title: data.title })
  cache.set(key, data.id)
  return data.id
}

function resolveDevice(row: StaffImportRow, devices: Device[]): string | null {
  if (!devices.length) return null
  if (row.deviceIp) {
    const byIp = devices.find((d) => d.ip_address === row.deviceIp)
    if (byIp) return byIp.id
    const partial = devices.find((d) => (d.ip_address ?? '').includes(row.deviceIp!))
    if (partial) return partial.id
  }
  const label = row.deviceLabel.toLowerCase()
  if (label) {
    const byName = devices.find((d) => label.includes(d.name.toLowerCase()) || d.name.toLowerCase().includes('office'))
    if (byName) return byName.id
  }
  return devices[0]?.id ?? null
}

async function upsertCompensation(employeeId: string, salary: number, canSetSalary: boolean): Promise<void> {
  if (!canSetSalary || salary <= 0) return
  const effectiveFrom = today()
  const payload = {
    employee_id: employeeId,
    effective_from: effectiveFrom,
    effective_to: null,
    basic: salary,
    house_rent: 0,
    medical: 0,
    conveyance: 0,
    utilities: 0,
    other_allowances: 0,
    pay_frequency: 'Monthly',
    currency: 'PKR',
    revision_reason: 'Imported from Staff Status Report',
  }
  const { data: existing } = await supabase
    .from('employee_salary_history')
    .select('id')
    .eq('employee_id', employeeId)
    .eq('effective_from', effectiveFrom)
    .maybeSingle()
  if (existing?.id) {
    await supabase.from('employee_salary_history').update(payload).eq('id', existing.id)
  } else {
    await supabase.from('employee_salary_history').insert(payload)
  }
}

async function upsertStatutory(employeeId: string): Promise<void> {
  const effectiveFrom = today()
  const payload = {
    employee_id: employeeId,
    effective_from: effectiveFrom,
    eobi_enabled: true,
    eobi_custom_amount: null,
    pf_enabled: false,
    pf_employee_pct: null,
    pf_employer_pct: null,
    social_security_enabled: false,
    social_security_custom_amount: null,
    income_tax_enabled: true,
  }
  const { data: existing } = await supabase
    .from('employee_statutory_enrollment')
    .select('id')
    .eq('employee_id', employeeId)
    .eq('effective_from', effectiveFrom)
    .maybeSingle()
  if (existing?.id) {
    await supabase.from('employee_statutory_enrollment').update(payload).eq('id', existing.id)
  } else {
    await supabase.from('employee_statutory_enrollment').insert(payload)
  }
}

async function upsertImportDocument(employeeId: string, row: StaffImportRow, userId: string): Promise<void> {
  const lines = [
    'Imported from Staff Status Report',
    `Name: ${row.fullName}`,
    `CNIC: ${row.cnic}`,
    row.mobile ? `Mobile: ${row.mobile}` : null,
    row.address ? `Address: ${row.address}` : null,
    row.deviceLabel ? `Device: ${row.deviceLabel}` : null,
  ].filter(Boolean) as string[]

  const path = `${employeeId}/import_staff_status_${Date.now()}.txt`
  const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
  const { error: upErr } = await supabase.storage.from(DOC_BUCKET).upload(path, blob, {
    contentType: 'text/plain',
    upsert: true,
  })
  if (upErr) throw new Error(`Document upload: ${upErr.message}`)

  const title = row.cnic.startsWith('9') && row.cnic.length === 13 ? `CNIC (import) — ${row.fullName}` : `CNIC — ${row.cnic}`
  const { data: existing } = await supabase
    .from('employee_documents')
    .select('id')
    .eq('employee_id', employeeId)
    .eq('doc_type', 'CNIC')
    .ilike('title', `%${row.fullName.slice(0, 20)}%`)
    .limit(1)

  const docPayload = {
    employee_id: employeeId,
    doc_type: 'CNIC',
    title,
    storage_path: path,
    file_size: blob.size,
    mime_type: 'text/plain',
    issued_on: null,
    expires_on: null,
    notes: row.address || 'Imported metadata — upload scanned CNIC when available.',
    uploaded_by: userId,
  }

  if (existing?.length) {
    await supabase.from('employee_documents').update(docPayload).eq('id', existing[0].id)
  } else {
    await supabase.from('employee_documents').insert(docPayload)
  }
}

export async function runStaffStatusImport(
  importRows: StaffImportRow[],
  opts: ImportOpts
): Promise<StaffImportRunResult> {
  const [bRes, dRes, desRes, devRes, empCodesRes, empListRes] = await Promise.all([
    supabase.from('branches').select('id, name').eq('is_active', true),
    supabase.from('departments').select('id, name').eq('is_active', true),
    supabase.from('designations').select('id, title').eq('is_active', true),
    supabase
      .from('attendance_devices')
      .select('id, name, ip_address')
      .eq('device_type', 'ZKTeco')
      .eq('is_active', true),
    supabase.from('employees').select('employee_code').eq('company_id', opts.companyId).order('employee_code', { ascending: false }).limit(50),
    supabase
      .from('employees')
      .select('id, cnic, device_pin, first_name, last_name, full_name')
      .eq('company_id', opts.companyId),
  ])

  const branches = [...(bRes.data ?? [])] as Lookup[]
  const departments = [...(dRes.data ?? [])] as Lookup[]
  const designations = [...(desRes.data ?? [])] as Lookup[]
  const devices = (devRes.data ?? []) as Device[]

  const branchCache = new Map<string, string>()
  const deptCache = new Map<string, string>()
  const desCache = new Map<string, string>()

  let codeCounter = 0
  const lastCode = (empCodesRes.data ?? [])[0]?.employee_code as string | undefined
  const m = lastCode?.match(/(\d+)\s*$/)
  let nextEmpNum = m ? parseInt(m[1], 10) + 1 : 1

  const allocCode = () => {
    const code = `EMP-${String(nextEmpNum + codeCounter).padStart(4, '0')}`
    codeCounter++
    return code
  }

  const employeeIndex: EmployeeListRow[] = [...((empListRes.data ?? []) as EmployeeListRow[])]
  const seenInFile = new Set<string>()
  const pinTakenInCompany = new Set(
    employeeIndex.filter((e) => e.device_pin != null && e.device_pin > 0).map((e) => e.device_pin as number)
  )

  const results: StaffImportRowResult[] = []
  let created = 0
  let updated = 0
  let skipped = 0
  let duplicates = 0
  let errors = 0

  for (let i = 0; i < importRows.length; i++) {
    const row = importRows[i]
    opts.onProgress?.(i + 1, importRows.length)

    try {
      const branchId = await ensureBranch(opts.companyId, row.branch || 'Head Office', branchCache, branches)
      const departmentId = await ensureDepartment(opts.companyId, row.department, deptCache, departments)
      const designationId = await ensureDesignation(opts.companyId, row.designation, desCache, designations)
      const deviceId = resolveDevice(row, devices)

      const fileKey = importRowDedupeKey(row, deviceId)
      if (seenInFile.has(fileKey)) {
        results.push({
          row,
          status: 'duplicate',
          message: 'Duplicate row in Excel file — skipped',
        })
        duplicates++
        continue
      }
      seenInFile.add(fileKey)

      const dup = findDuplicateInList(row, employeeIndex)
      const existingId = dup?.employeeId ?? null

      let assignPin =
        row.devicePin != null && row.devicePin > 0 ? row.devicePin : null
      if (assignPin != null && pinTakenInCompany.has(assignPin)) {
        const pinOwner = employeeIndex.find((e) => e.device_pin === assignPin)
        const pinOwnerId = pinOwner?.id
        if (!existingId || pinOwnerId !== existingId) {
          assignPin = null
        }
      }

      const profile = {
        first_name: row.firstName,
        last_name: row.lastName,
        email: null,
        phone: row.mobile || null,
        cnic: row.cnic,
        gender: null,
        date_of_birth: null,
        date_of_joining: today(),
        employment_status: 'Active' as const,
        branch_id: branchId,
        department_id: departmentId,
        designation_id: designationId,
        reports_to_id: null,
        device_pin: assignPin,
        is_active: true,
      }

      let employeeId = existingId
      let pinWarning: string | undefined

      if (existingId) {
        const { error } = await supabase.from('employees').update(profile).eq('id', existingId)
        if (error) throw new Error(error.message)
        const idx = employeeIndex.findIndex((e) => e.id === existingId)
        const merged = { id: existingId, ...profile, full_name: row.fullName }
        if (idx >= 0) employeeIndex[idx] = { ...employeeIndex[idx], ...merged }
        else employeeIndex.push(merged as EmployeeListRow)
        updated++
        results.push({
          row,
          status: 'updated',
          employeeId: existingId,
          message: dup?.label,
        })
      } else {
        const { data, error } = await supabase
          .from('employees')
          .insert({
            ...profile,
            company_id: opts.companyId,
            employee_code: allocCode(),
          })
          .select('id')
          .single()
        if (error || !data) throw new Error(error?.message ?? 'Insert failed')
        employeeId = data.id
        employeeIndex.push({
          id: data.id,
          cnic: profile.cnic,
          device_pin: profile.device_pin,
          first_name: profile.first_name,
          last_name: profile.last_name,
          full_name: row.fullName,
        })
        if (assignPin != null) pinTakenInCompany.add(assignPin)
        created++
        results.push({ row, status: 'created', employeeId: data.id })
      }

      if (
        row.devicePin != null &&
        row.devicePin > 0 &&
        assignPin == null &&
        !existingId
      ) {
        pinWarning = `Device PIN ${row.devicePin} already used — employee saved without PIN`
      }

      if (employeeId && deviceId && assignPin != null) {
        try {
          await syncEmployeeDevicePin(employeeId, opts.companyId, deviceId, assignPin)
        } catch (pinErr) {
          const msg = pinErr instanceof Error ? pinErr.message : 'Device PIN not linked'
          pinWarning = pinWarning ? `${pinWarning}; ${msg}` : msg
        }
      }

      if (pinWarning) {
        const last = results[results.length - 1]
        if (last) last.message = last.message ? `${last.message}; ${pinWarning}` : pinWarning
      }

      await upsertCompensation(employeeId!, row.salary, opts.canSetSalary)
      await upsertStatutory(employeeId!)
      await upsertImportDocument(employeeId!, row, opts.userId)
    } catch (e) {
      errors++
      results.push({
        row,
        status: 'error',
        message: e instanceof Error ? e.message : 'Import failed',
      })
    }
  }

  return { created, updated, skipped, duplicates, errors, rows: results }
}
