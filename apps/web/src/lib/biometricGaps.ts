import type { ZktBiometricScanResponse } from '@/lib/zktAgent'

export type EmployeePinAssignment = {
  employee_id: string
  device_id: string
  device_pin: number
}

export type EmployeeForBioGap = {
  id: string
  employee_code: string
  full_name: string
  device_pin: number | null
  departments: { name: string } | null
}

export type BiometricGapRow = {
  employeeId: string
  code: string
  name: string
  department: string
  missingFinger: boolean
  missingFace: boolean
}

export type BiometricGapsByDepartment = {
  department: string
  rows: BiometricGapRow[]
}

function pickDepartment(e: EmployeeForBioGap): string {
  return e.departments?.name?.trim() || 'Unassigned'
}

/** One row per employee with device PIN — missing finger and/or face on their assigned device. */
export function buildBiometricGaps(
  employees: EmployeeForBioGap[],
  pinRows: EmployeePinAssignment[],
  scan: ZktBiometricScanResponse | null
): { byDepartment: BiometricGapsByDepartment[]; agentOffline: boolean; scannedAt: string | null } {
  if (!scan?.ok) {
    return { byDepartment: [], agentOffline: true, scannedAt: null }
  }

  const pinByDevice = new Map<string, Map<number, { hasFinger: boolean; hasFace: boolean; supportsFace: boolean }>>()
  for (const device of scan.devices) {
    if (!device.scanned) continue
    const map = new Map<number, { hasFinger: boolean; hasFace: boolean; supportsFace: boolean }>()
    for (const u of device.users) {
      map.set(u.pin, {
        hasFinger: u.hasFinger,
        hasFace: u.hasFace,
        supportsFace: device.supportsFace,
      })
    }
    pinByDevice.set(device.id, map)
  }

  const empById = new Map(employees.map((e) => [e.id, e]))
  const assignmentByEmployee = new Map<string, EmployeePinAssignment>()
  for (const row of pinRows) {
    assignmentByEmployee.set(row.employee_id, row)
  }

  const gaps: BiometricGapRow[] = []
  const seen = new Set<string>()

  for (const emp of employees) {
    if (seen.has(emp.id)) continue

    const assignment = assignmentByEmployee.get(emp.id)
    let deviceId = assignment?.device_id
    const pin = assignment?.device_pin ?? (emp.device_pin && emp.device_pin > 0 ? emp.device_pin : null)

    if (!pin || pin <= 0) continue

    let devicePins = deviceId ? pinByDevice.get(deviceId) : undefined
    if (!devicePins && pinByDevice.size === 1) {
      deviceId = [...pinByDevice.keys()][0]
      devicePins = pinByDevice.get(deviceId)
    }
    if (!devicePins) {
      for (const [devId, map] of pinByDevice) {
        if (map.has(pin)) {
          deviceId = devId
          devicePins = map
          break
        }
      }
    }
    if (!devicePins) continue

    const bio = devicePins.get(pin)
    if (!bio) {
      gaps.push({
        employeeId: emp.id,
        code: emp.employee_code,
        name: emp.full_name,
        department: pickDepartment(emp),
        missingFinger: true,
        missingFace: false,
      })
      seen.add(emp.id)
      continue
    }

    const missingFinger = !bio.hasFinger
    const missingFace = bio.supportsFace && !bio.hasFace
    if (!missingFinger && !missingFace) continue

    gaps.push({
      employeeId: emp.id,
      code: emp.employee_code,
      name: emp.full_name,
      department: pickDepartment(emp),
      missingFinger,
      missingFace,
    })
    seen.add(emp.id)
  }

  const grouped = new Map<string, BiometricGapRow[]>()
  for (const row of gaps) {
    const list = grouped.get(row.department) ?? []
    list.push(row)
    grouped.set(row.department, list)
  }

  const byDepartment = Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([department, rows]) => ({
      department,
      rows: rows.sort((a, b) => a.name.localeCompare(b.name)),
    }))

  return {
    byDepartment,
    agentOffline: false,
    scannedAt: scan.scannedAt ?? null,
  }
}
