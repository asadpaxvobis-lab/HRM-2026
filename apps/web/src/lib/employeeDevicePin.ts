import { supabase } from '@/lib/supabase'

export type ZktPinMapEntry = {
  employee_id: string
  device_id: string
  device_pin: number
}

const SETTINGS_KEY = 'zkt_device_pin_map'

function isMissingTableError(error: { message?: string; code?: string }): boolean {
  const msg = error.message ?? ''
  return (
    msg.includes('employee_device_pins') &&
    (msg.includes('does not exist') || msg.includes('schema cache') || error.code === 'PGRST205')
  )
}

function mapPinError(error: { message?: string; code?: string; details?: string }): string {
  const msg = error.message ?? ''
  if (isMissingTableError(error)) {
    return 'Using temporary storage. For best results, run supabase/APPLY_PENDING_DEVICES.sql in Supabase SQL Editor.'
  }
  if (error.code === '23505' || msg.includes('duplicate key')) {
    if (msg.includes('device_pin') || msg.includes('device_id')) {
      return 'This PIN is already used by another employee on this device. Use a different PIN or edit that employee first.'
    }
    return 'Duplicate PIN on this device.'
  }
  if (error.code === '42501' || msg.includes('permission')) {
    return 'Permission denied. You need employee.update (and settings.update for backup storage).'
  }
  return msg || error.details || 'Could not save per-device PIN'
}

async function loadSettingsMap(companyId: string): Promise<ZktPinMapEntry[]> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('settings')
    .eq('company_id', companyId)
    .single()
  if (error) throw error
  const raw = (data?.settings as Record<string, unknown> | null)?.[SETTINGS_KEY]
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (x): x is ZktPinMapEntry =>
      typeof x === 'object' &&
      x != null &&
      typeof (x as ZktPinMapEntry).employee_id === 'string' &&
      typeof (x as ZktPinMapEntry).device_id === 'string' &&
      typeof (x as ZktPinMapEntry).device_pin === 'number'
  )
}

async function saveSettingsMap(companyId: string, map: ZktPinMapEntry[]): Promise<void> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('settings')
    .eq('company_id', companyId)
    .single()
  if (error) throw error
  const settings = { ...((data?.settings as Record<string, unknown>) ?? {}), [SETTINGS_KEY]: map }
  const { error: upErr } = await supabase
    .from('app_settings')
    .update({ settings })
    .eq('company_id', companyId)
  if (upErr) throw upErr
}

async function syncViaAppSettings(
  companyId: string,
  employeeId: string,
  deviceId: string | null,
  devicePin: number | null
): Promise<void> {
  let map = await loadSettingsMap(companyId)
  map = map.filter((e) => e.employee_id !== employeeId)
  if (deviceId && devicePin && devicePin > 0) {
    const clash = map.find((e) => e.device_id === deviceId && e.device_pin === devicePin)
    if (clash && clash.employee_id !== employeeId) {
      throw new Error(
        'This PIN is already used by another employee on this device. Use a different PIN or edit that employee first.'
      )
    }
    map.push({ employee_id: employeeId, device_id: deviceId, device_pin: devicePin })
  }
  await saveSettingsMap(companyId, map)
}

export type SyncEmployeeDevicePinResult = {
  usedFallback?: boolean
}

/** Link employee to a specific ZKTeco device + user ID on that machine. */
export async function syncEmployeeDevicePin(
  employeeId: string,
  companyId: string,
  deviceId: string | null,
  devicePin: number | null
): Promise<SyncEmployeeDevicePinResult> {
  if (!deviceId || !devicePin || devicePin <= 0) {
    const { error } = await supabase.from('employee_device_pins').delete().eq('employee_id', employeeId)
    if (!error) {
      await syncViaAppSettings(companyId, employeeId, null, null).catch(() => undefined)
      return {}
    }
    if (isMissingTableError(error)) {
      await syncViaAppSettings(companyId, employeeId, null, null)
      return { usedFallback: true }
    }
    throw new Error(mapPinError(error))
  }

  const { error: delErr } = await supabase.from('employee_device_pins').delete().eq('employee_id', employeeId)
  if (!delErr) {
    const { error: insErr } = await supabase.from('employee_device_pins').insert({
      company_id: companyId,
      employee_id: employeeId,
      device_id: deviceId,
      device_pin: devicePin,
    })
    if (!insErr) {
      await syncViaAppSettings(companyId, employeeId, deviceId, devicePin).catch(() => undefined)
      return {}
    }
    if (!isMissingTableError(insErr)) throw new Error(mapPinError(insErr))
  } else if (!isMissingTableError(delErr)) {
    throw new Error(mapPinError(delErr))
  }

  await syncViaAppSettings(companyId, employeeId, deviceId, devicePin)
  return { usedFallback: true }
}

export async function loadEmployeeDevicePin(employeeId: string, companyId?: string): Promise<{
  device_id: string | null
  device_pin: number | null
}> {
  const { data, error } = await supabase
    .from('employee_device_pins')
    .select('device_id, device_pin')
    .eq('employee_id', employeeId)
    .maybeSingle()
  if (!error && data) {
    return { device_id: data.device_id ?? null, device_pin: data.device_pin ?? null }
  }
  if (error && !isMissingTableError(error)) throw error

  if (!companyId) return { device_id: null, device_pin: null }
  const map = await loadSettingsMap(companyId)
  const row = map.find((e) => e.employee_id === employeeId)
  return { device_id: row?.device_id ?? null, device_pin: row?.device_pin ?? null }
}

export async function loadAllDevicePinRows(companyId: string): Promise<
  Array<ZktPinMapEntry & { attendance_devices?: { name: string } | null }>
> {
  const { data, error } = await supabase
    .from('employee_device_pins')
    .select('employee_id, device_id, device_pin, attendance_devices(name)')
    .order('device_pin')
  if (!error) {
    return (data ?? []).map((r) => {
      const dev = (r as { attendance_devices?: unknown }).attendance_devices
      return {
        ...(r as ZktPinMapEntry),
        attendance_devices: Array.isArray(dev) ? (dev[0] as { name: string }) : (dev as { name: string } | null),
      }
    })
  }
  if (!isMissingTableError(error)) return []

  const map = await loadSettingsMap(companyId)
  const { data: devices } = await supabase.from('attendance_devices').select('id, name')
  const nameById = new Map((devices ?? []).map((d) => [d.id, d.name]))
  return map.map((row) => ({
    ...row,
    attendance_devices: { name: nameById.get(row.device_id) ?? 'Device' },
  }))
}
