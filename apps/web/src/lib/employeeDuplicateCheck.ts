import { supabase } from '@/lib/supabase'

export type EmployeeDuplicateMatch = {
  employeeId: string
  reason: 'cnic' | 'device_pin' | 'name' | 'device_mapping'
  label: string
}

export type EmployeeListRow = {
  id: string
  cnic: string | null
  device_pin: number | null
  first_name: string
  last_name: string | null
  full_name?: string | null
}

const normName = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')

export function normalizedEmployeeName(first: string, last: string | null): string {
  return normName(`${first} ${last ?? ''}`.trim())
}

/** Key used to detect duplicate rows within one import file. */
export function importRowDedupeKey(
  row: { cnic: string; hasRealCnic: boolean; devicePin: number | null; fullName: string },
  deviceId: string | null
): string {
  if (row.hasRealCnic) return `cnic:${row.cnic}`
  if (row.devicePin != null && row.devicePin > 0 && deviceId) {
    return `pin:${deviceId}:${row.devicePin}:${normName(row.fullName)}`
  }
  if (row.devicePin != null && row.devicePin > 0) {
    return `pin:${row.devicePin}:${normName(row.fullName)}`
  }
  return `name:${normName(row.fullName)}`
}

export function findDuplicateInList(
  row: {
    cnic: string
    hasRealCnic: boolean
    devicePin: number | null
    firstName: string
    lastName: string
    fullName: string
  },
  employees: EmployeeListRow[],
  excludeEmployeeId?: string | null
): EmployeeDuplicateMatch | null {
  const nameKey = normalizedEmployeeName(row.firstName, row.lastName)

  for (const e of employees) {
    if (excludeEmployeeId && e.id === excludeEmployeeId) continue

    if (row.hasRealCnic && e.cnic && e.cnic.replace(/\D/g, '') === row.cnic.replace(/\D/g, '')) {
      return {
        employeeId: e.id,
        reason: 'cnic',
        label: `CNIC ${row.cnic} already used`,
      }
    }

    if (row.devicePin != null && row.devicePin > 0 && e.device_pin === row.devicePin) {
      const existingName = normalizedEmployeeName(e.first_name, e.last_name)
      if (existingName === nameKey) {
        return {
          employeeId: e.id,
          reason: 'device_pin',
          label: `Device PIN ${row.devicePin} already assigned`,
        }
      }
    }

    const existingName = normalizedEmployeeName(e.first_name, e.last_name)
    if (existingName === nameKey && existingName.length > 2) {
      return {
        employeeId: e.id,
        reason: 'name',
        label: `Employee "${row.fullName.trim()}" already exists`,
      }
    }
  }

  return null
}

export async function loadCompanyEmployees(companyId: string): Promise<EmployeeListRow[]> {
  const { data, error } = await supabase
    .from('employees')
    .select('id, cnic, device_pin, first_name, last_name, full_name')
    .eq('company_id', companyId)

  if (error) throw new Error(error.message)
  return (data ?? []) as EmployeeListRow[]
}

export async function findDuplicateEmployeeOnline(
  companyId: string,
  row: {
    cnic: string
    hasRealCnic: boolean
    devicePin: number | null
    firstName: string
    lastName: string
    fullName: string
  },
  deviceId: string | null,
  excludeEmployeeId?: string | null
): Promise<EmployeeDuplicateMatch | null> {
  const employees = await loadCompanyEmployees(companyId)
  const hit = findDuplicateInList(row, employees, excludeEmployeeId)
  if (hit) return hit

  if (row.devicePin != null && row.devicePin > 0 && deviceId) {
    const { data: map } = await supabase
      .from('employee_device_pins')
      .select('employee_id')
      .eq('device_id', deviceId)
      .eq('device_pin', row.devicePin)
      .maybeSingle()
    if (map?.employee_id && map.employee_id !== excludeEmployeeId) {
      return {
        employeeId: map.employee_id,
        reason: 'device_mapping',
        label: `PIN ${row.devicePin} already linked on this device`,
      }
    }
  }

  return null
}

/** Manual add / edit — block when CNIC, device PIN, or exact name clashes. */
export async function findDuplicateForForm(opts: {
  companyId: string
  cnic: string
  devicePin: number | null
  firstName: string
  lastName: string
  excludeEmployeeId?: string | null
}): Promise<EmployeeDuplicateMatch | null> {
  const cnicDigits = opts.cnic.replace(/\D/g, '')
  const hasRealCnic = cnicDigits.length >= 13

  return findDuplicateEmployeeOnline(
    opts.companyId,
    {
      cnic: cnicDigits.length >= 5 ? cnicDigits.padStart(13, '0').slice(0, 13) : opts.cnic.trim(),
      hasRealCnic,
      devicePin: opts.devicePin,
      firstName: opts.firstName.trim(),
      lastName: opts.lastName.trim(),
      fullName: `${opts.firstName} ${opts.lastName}`.trim(),
    },
    null,
    opts.excludeEmployeeId
  )
}
