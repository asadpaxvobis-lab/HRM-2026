import { supabase } from '@/lib/supabase'
import { nextCode } from '@/lib/codegen'
import { nextDepartmentCode } from '@/lib/departmentCodes'
import { syncEmployeeDevicePin } from '@/lib/employeeDevicePin'
import {
  findImportDuplicate,
  importRowDedupeKey,
  type EmployeeListRow,
} from '@/lib/employeeDuplicateCheck'
import {
  matchBranchName,
  matchDepartmentName,
  matchDesignationTitle,
  matchEmployeeByName,
  normPersonName,
  type StaffImportRow,
} from '@/lib/staffStatusImport'

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
  const matched = matchBranchName(name, list as (Lookup & { id: string })[])
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
  const matched = matchDepartmentName(name, list as (Lookup & { id: string })[])
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
  const matched = matchDesignationTitle(title, list as (Lookup & { id: string })[])
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

async function clearDevicePinFromOthers(
  companyId: string,
  pin: number,
  keepEmployeeId: string,
  employeeIndex: EmployeeListRow[]
): Promise<void> {
  await supabase
    .from('employees')
    .update({ device_pin: null })
    .eq('company_id', companyId)
    .eq('device_pin', pin)
    .neq('id', keepEmployeeId)

  for (const e of employeeIndex) {
    if (e.id !== keepEmployeeId && e.device_pin === pin) {
      e.device_pin = null
    }
  }
}

async function upsertCompensation(
  employeeId: string,
  salary: number,
  allowances: number,
  payFrequency: string | null,
  canSetSalary: boolean,
  sourceLabel: string,
  effectiveFrom?: string | null
): Promise<void> {
  if (!canSetSalary || salary <= 0) return
  const from = effectiveFrom?.trim() || today()
  const payload = {
    employee_id: employeeId,
    effective_from: from,
    effective_to: null,
    basic: salary,
    house_rent: 0,
    medical: 0,
    conveyance: 0,
    utilities: 0,
    other_allowances: allowances,
    other_allowances_enabled: allowances > 0,
    house_rent_enabled: false,
    medical_enabled: false,
    conveyance_enabled: false,
    utilities_enabled: false,
    pay_frequency: payFrequency?.trim() || 'Monthly',
    currency: 'PKR',
    revision_reason: `Imported from ${sourceLabel}`,
  }
  const { data: existing } = await supabase
    .from('employee_salary_history')
    .select('id')
    .eq('employee_id', employeeId)
    .eq('effective_from', from)
    .maybeSingle()
  if (existing?.id) {
    await supabase.from('employee_salary_history').update(payload).eq('id', existing.id)
  } else {
    await supabase.from('employee_salary_history').insert(payload)
  }
}

async function upsertStatutory(employeeId: string, effectiveFrom?: string | null): Promise<void> {
  const from = effectiveFrom?.trim() || today()
  const payload = {
    employee_id: employeeId,
    effective_from: from,
    eobi_enabled: false,
    eobi_custom_amount: null,
    pf_enabled: false,
    pf_employee_pct: null,
    pf_employer_pct: null,
    social_security_enabled: false,
    social_security_custom_amount: null,
    income_tax_enabled: false,
  }
  const { data: existing } = await supabase
    .from('employee_statutory_enrollment')
    .select('id')
    .eq('employee_id', employeeId)
    .eq('effective_from', from)
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
    supabase.from('branches').select('id, name').eq('company_id', opts.companyId).eq('is_active', true),
    supabase.from('departments').select('id, name').eq('company_id', opts.companyId).eq('is_active', true),
    supabase.from('designations').select('id, title').eq('company_id', opts.companyId).eq('is_active', true),
    supabase
      .from('attendance_devices')
      .select('id, name, ip_address')
      .eq('device_type', 'ZKTeco')
      .eq('is_active', true),
    supabase.from('employees').select('employee_code').eq('company_id', opts.companyId).order('employee_code', { ascending: false }).limit(50),
    supabase
      .from('employees')
      .select('id, employee_code, cnic, device_pin, first_name, last_name, full_name')
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
  const reportsToPending: { employeeId: string; reportsToName: string }[] = []
  let created = 0
  let updated = 0
  let skipped = 0
  let duplicates = 0
  let errors = 0

  const sourceLabel =
    importRows[0]?.source === 'employee_directory' ? 'Employee Directory Report' : 'Staff Status Report'

  for (let i = 0; i < importRows.length; i++) {
    const row = importRows[i]
    opts.onProgress?.(i + 1, importRows.length)

    try {
      if (!row.branch?.trim()) throw new Error('Branch missing in Excel row')
      if (!row.department?.trim()) throw new Error('Department missing in Excel row')
      if (!row.designation?.trim()) throw new Error('Designation missing in Excel row')

      const branchId = await ensureBranch(opts.companyId, row.branch.trim(), branchCache, branches)
      const departmentId = await ensureDepartment(opts.companyId, row.department.trim(), deptCache, departments)
      const designationId = await ensureDesignation(opts.companyId, row.designation.trim(), desCache, designations)
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

      const dup = findImportDuplicate(row, employeeIndex)
      const existingId = dup?.employeeId ?? null

      const assignPin = row.devicePin != null && row.devicePin > 0 ? row.devicePin : null

      const profile = {
        first_name: row.firstName,
        last_name: row.lastName,
        email: null,
        phone: row.mobile || null,
        cnic: row.cnic,
        gender: null,
        date_of_birth: row.dateOfBirth,
        date_of_joining: row.dateOfJoining || today(),
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

      if (employeeId && assignPin != null) {
        await clearDevicePinFromOthers(opts.companyId, assignPin, employeeId, employeeIndex)
      }

      if (existingId) {
        // Also update employee_code if Excel has one and it matches what DB already has or DB has wrong one
        const updatePayload: Record<string, unknown> = { ...profile }
        if (row.employeeCode?.trim()) {
          updatePayload.employee_code = row.employeeCode.trim()
        }
        const { error } = await supabase.from('employees').update(updatePayload).eq('id', existingId)
        if (error) throw new Error(error.message)
        const idx = employeeIndex.findIndex((e) => e.id === existingId)
        const merged: EmployeeListRow = {
          id: existingId,
          employee_code: row.employeeCode?.trim() || employeeIndex[idx]?.employee_code || null,
          cnic: profile.cnic,
          device_pin: assignPin,
          first_name: profile.first_name,
          last_name: profile.last_name,
          full_name: row.fullName,
        }
        if (idx >= 0) employeeIndex[idx] = { ...employeeIndex[idx], ...merged }
        else employeeIndex.push(merged)
        updated++
        results.push({
          row,
          status: 'updated',
          employeeId: existingId,
          message: dup?.label,
        })
      } else {
        // Use exact code from Excel; only fall back to auto-generated if Excel has none
        const newCode = row.employeeCode?.trim() || allocCode()
        const { data, error } = await supabase
          .from('employees')
          .insert({
            ...profile,
            company_id: opts.companyId,
            employee_code: newCode,
          })
          .select('id')
          .single()
        if (error || !data) throw new Error(error?.message ?? 'Insert failed')
        employeeId = data.id
        employeeIndex.push({
          id: data.id,
          employee_code: newCode,
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

      // Sync device PIN mapping — force-assign even if another employee had this PIN
      if (employeeId && assignPin != null) {
        if (deviceId) {
          try {
            // Remove existing mapping for this PIN on this device first (force re-assign)
            await supabase
              .from('employee_device_pins')
              .delete()
              .eq('device_id', deviceId)
              .eq('device_pin', assignPin)
              .neq('employee_id', employeeId)
            await syncEmployeeDevicePin(employeeId, opts.companyId, deviceId, assignPin)
          } catch (pinErr) {
            const msg = pinErr instanceof Error ? pinErr.message : 'Device PIN not linked'
            pinWarning = pinWarning ? `${pinWarning}; ${msg}` : msg
          }
        }
        // Also update the employees.device_pin column to always reflect Excel value
        await supabase.from('employees').update({ device_pin: assignPin }).eq('id', employeeId)
      }

      if (pinWarning) {
        const last = results[results.length - 1]
        if (last) last.message = last.message ? `${last.message}; ${pinWarning}` : pinWarning
      }

      if (row.reportsToName?.trim()) {
        reportsToPending.push({ employeeId: employeeId!, reportsToName: row.reportsToName.trim() })
      }

      await upsertCompensation(
        employeeId!,
        row.salary,
        row.allowances,
        row.payFrequency,
        opts.canSetSalary,
        sourceLabel,
        row.dateOfJoining
      )
      await upsertStatutory(employeeId!, row.dateOfJoining)
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

  for (const pending of reportsToPending) {
    const managerId = matchEmployeeByName(pending.reportsToName, employeeIndex)
    if (managerId && managerId !== pending.employeeId) {
      await supabase.from('employees').update({ reports_to_id: managerId }).eq('id', pending.employeeId)
    }
  }

  return { created, updated, skipped, duplicates, errors, rows: results }
}
