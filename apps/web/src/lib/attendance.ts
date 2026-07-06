import { supabase } from '@/lib/supabase'

/** Used when an employee has no shift assignment. */
export const DEFAULT_SHIFT = {
  start_time: '09:00',
  end_time: '17:00',
  break_minutes: 0,
  grace_late_minutes: 15,
  grace_early_minutes: 15,
  is_night: false,
}

const STANDARD_DAY_MINUTES = 8 * 60
/** Pakistan default; matches companies.timezone seed (Asia/Karachi, UTC+5, no DST). */
const COMPANY_TZ_OFFSET_MINUTES = 5 * 60

function parseShiftTime(timeStr: string): [number, number] {
  const [h, m] = timeStr.split(':').map(Number)
  return [h ?? 0, m ?? 0]
}

function combineDateTime(dateStr: string, timeStr: string): Date {
  const [h, m] = parseShiftTime(timeStr)
  const [y, mo, d] = dateStr.split('-').map(Number)
  // Wall-clock time in company TZ → UTC instant (same as Postgres timezone('Asia/Karachi', ...))
  return new Date(Date.UTC(y, mo - 1, d, h, m, 0) - COMPANY_TZ_OFFSET_MINUTES * 60_000)
}

function normalizeShift(shift?: ShiftLike | null): ShiftLike {
  const start = shift?.start_time != null ? String(shift.start_time) : ''
  const end = shift?.end_time != null ? String(shift.end_time) : ''
  if (!start || !end) return DEFAULT_SHIFT
  return {
    ...shift,
    start_time: start.slice(0, 5),
    end_time: end.slice(0, 5),
  }
}

export function formatShiftWindow(shift?: ShiftLike | null): string {
  const s = normalizeShift(shift)
  return `${s.start_time} – ${s.end_time} (grace late ${s.grace_late_minutes ?? 15}m)`
}

function diffMinutes(a: Date, b: Date): number {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000))
}

type ShiftLike = {
  start_time?: string
  end_time?: string
  break_minutes?: number
  grace_late_minutes?: number
  grace_early_minutes?: number
  is_night?: boolean
}

/** Derive worked / late / early-out / OT from punch times (used by UI + aggregator). */
export function computeAttendanceMetrics(
  dateStr: string,
  first_in: string | null,
  last_out: string | null,
  shift?: ShiftLike | null,
  scheduled_start?: string | null,
  scheduled_end?: string | null
): {
  worked_minutes: number
  late_minutes: number
  early_out_minutes: number
  overtime_minutes: number
  gross_overtime_minutes: number
} {
  const cfg = normalizeShift(shift)
  const firstIn = first_in ? new Date(first_in) : null
  const lastOut = last_out ? new Date(last_out) : null

  let scheduledStart: Date | null = scheduled_start ? new Date(scheduled_start) : null
  let scheduledEnd: Date | null = scheduled_end ? new Date(scheduled_end) : null
  if (!scheduledStart && cfg.start_time) scheduledStart = combineDateTime(dateStr, cfg.start_time)
  if (!scheduledEnd && cfg.end_time) scheduledEnd = combineDateTime(dateStr, cfg.end_time)
  if (scheduledStart && scheduledEnd && cfg.is_night && scheduledEnd <= scheduledStart) {
    scheduledEnd = new Date(scheduledEnd.getTime() + 24 * 3600 * 1000)
  }

  let worked_minutes = 0
  if (firstIn && lastOut) {
    worked_minutes = Math.max(0, diffMinutes(firstIn, lastOut) - (cfg.break_minutes ?? 0))
  }

  let late_minutes = 0
  let early_out_minutes = 0
  let gross_overtime_minutes = 0

  if (firstIn && scheduledStart) {
    const lateRaw = diffMinutes(scheduledStart, firstIn)
    late_minutes = Math.max(0, lateRaw - (cfg.grace_late_minutes ?? 0))
  }
  if (lastOut && scheduledEnd) {
    if (lastOut < scheduledEnd) {
      const earlyRaw = diffMinutes(lastOut, scheduledEnd)
      early_out_minutes = Math.max(0, earlyRaw - (cfg.grace_early_minutes ?? 0))
    } else if (lastOut > scheduledEnd) {
      gross_overtime_minutes = diffMinutes(scheduledEnd, lastOut)
    }
  } else if (worked_minutes > 0) {
    gross_overtime_minutes = Math.max(0, worked_minutes - STANDARD_DAY_MINUTES)
  }

  const overtime_minutes = overtimeAfterLate(gross_overtime_minutes, late_minutes)

  return { worked_minutes, late_minutes, early_out_minutes, overtime_minutes, gross_overtime_minutes }
}

/** Overtime shown/saved on working days = time after shift end minus late minutes. */
export function overtimeAfterLate(overtimeMinutes: number, lateMinutes: number): number {
  if (lateMinutes <= 0 || overtimeMinutes <= 0) return overtimeMinutes
  return Math.max(0, overtimeMinutes - lateMinutes)
}

/** Net OT for grid / forms (uses gross when available, else stored OT). */
export function displayOvertimeMinutes(metrics: {
  overtime_minutes: number
  late_minutes: number
  gross_overtime_minutes?: number
}): number {
  const gross = metrics.gross_overtime_minutes ?? metrics.overtime_minutes
  return overtimeAfterLate(gross, metrics.late_minutes)
}

export type DailyComputed = {
  employee_id: string
  company_id: string
  attendance_date: string
  shift_id: string | null
  scheduled_start: string | null
  scheduled_end: string | null
  first_in: string | null
  last_out: string | null
  worked_minutes: number
  late_minutes: number
  early_out_minutes: number
  overtime_minutes: number
  status: string
  is_weekly_off: boolean
  is_holiday: boolean
}

/**
 * Recompute attendance_daily via Postgres (recompute_attendance_daily RPC).
 * Punch inserts also auto-reaggregate via DB trigger.
 */
export async function saveManualAttendanceDay(params: {
  employeeId: string
  date: string
  firstInIso: string | null
  lastOutIso: string | null
  status: string
  notes?: string | null
  isHoliday?: boolean
  isWeeklyOff?: boolean
}): Promise<{ dailyId?: string; error?: string }> {
  const attendanceDate = dateFromEditInputs(
    params.firstInIso ? isoToLocalDatetimeInput(params.firstInIso) : '',
    params.lastOutIso ? isoToLocalDatetimeInput(params.lastOutIso) : '',
    params.date
  )
  const { data, error } = await supabase.rpc('set_manual_attendance_day', {
    p_employee_id: params.employeeId,
    p_date: attendanceDate,
    p_first_in: params.firstInIso,
    p_last_out: params.lastOutIso,
    p_status: params.status,
    p_notes: params.notes ?? null,
    p_is_holiday: params.isHoliday ?? false,
    p_is_weekly_off: params.isWeeklyOff ?? false,
  })
  if (error) return { error: error.message }
  return { dailyId: data as string | undefined }
}

export async function recomputeAttendanceDaily(companyId: string, dateStr: string) {
  const { data, error } = await supabase.rpc('recompute_attendance_daily', {
    p_company_id: companyId,
    p_date: dateStr,
  })
  if (error) throw error
  return { rows: (data as number) ?? 0 }
}

/** Parse `<input type="datetime-local">` value as company wall-clock (Asia/Karachi). */
export function localDatetimeInputToIso(local: string): string | null {
  const match = local?.trim().match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/)
  if (!match) return null
  const datePart = match[1]
  const y = Number(datePart.slice(0, 4))
  const mo = Number(datePart.slice(5, 7))
  const d = Number(datePart.slice(8, 10))
  const h = Number(match[2])
  const m = Number(match[3])
  if (!y || !mo || !d || Number.isNaN(h) || Number.isNaN(m)) return null
  return new Date(Date.UTC(y, mo - 1, d, h, m, 0) - COMPANY_TZ_OFFSET_MINUTES * 60_000).toISOString()
}

export function isCompleteDatetimeLocal(local: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local.trim())
}

/** Format UTC ISO for datetime-local input (company wall-clock). */
export function isoToLocalDatetimeInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const pk = new Date(d.getTime() + COMPANY_TZ_OFFSET_MINUTES * 60_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pk.getUTCFullYear()}-${pad(pk.getUTCMonth() + 1)}-${pad(pk.getUTCDate())}T${pad(pk.getUTCHours())}:${pad(pk.getUTCMinutes())}`
}

/** Date from datetime-local input, else attendance row date. */
export function dateFromEditInputs(firstInLocal: string, lastOutLocal: string, fallbackDate: string): string {
  const fromIn = firstInLocal.trim().split('T')[0]
  if (fromIn && /^\d{4}-\d{2}-\d{2}$/.test(fromIn)) return fromIn
  const fromOut = lastOutLocal.trim().split('T')[0]
  if (fromOut && /^\d{4}-\d{2}-\d{2}$/.test(fromOut)) return fromOut
  return fallbackDate
}

/** Auto-fill worked / late / early-out / OT in the edit-attendance form. */
export function metricsFromEditTimes(
  fallbackDate: string,
  firstInLocal: string,
  lastOutLocal: string,
  shift?: ShiftLike | null
) {
  if (!firstInLocal.trim()) {
    return { worked_minutes: 0, late_minutes: 0, early_out_minutes: 0, overtime_minutes: 0 }
  }
  const attendanceDate = dateFromEditInputs(firstInLocal, lastOutLocal, fallbackDate)
  const m = computeAttendanceMetrics(
    attendanceDate,
    localDatetimeInputToIso(firstInLocal),
    localDatetimeInputToIso(lastOutLocal),
    shift,
    null,
    null
  )
  return {
    worked_minutes: m.worked_minutes,
    late_minutes: m.late_minutes,
    early_out_minutes: m.early_out_minutes,
    overtime_minutes: m.overtime_minutes,
  }
}

export function fmtMinutes(mins: number, alwaysShow = false): string {
  if (!mins && !alwaysShow) return '—'
  if (!mins) return '0m'
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export type PunchLike = { punch_at: string; punch_type: string }

export type ShiftResolveLike = {
  start_time?: string
  end_time?: string
  is_night?: boolean
}

function minutesFromMidnightInTz(iso: string, tz = 'Asia/Karachi'): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso))
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0)
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
  return h * 60 + m
}

function parseClockToMinutes(timeStr: string): number {
  const [h, m] = timeStr.slice(0, 5).split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

/**
 * Classify an ambiguous (auto) punch as IN or OUT by proximity to shift start vs end.
 */
export function classifyPunchByShift(
  punchAt: string,
  shift?: ShiftResolveLike | null,
  tz = 'Asia/Karachi'
): 'in' | 'out' {
  const punchMin = minutesFromMidnightInTz(punchAt, tz)
  const cfg = normalizeShift(shift)
  const startMin = parseClockToMinutes(cfg.start_time!)
  let endMin = parseClockToMinutes(cfg.end_time!)
  const isNight = cfg.is_night ?? false

  if (isNight && endMin <= startMin) {
    let adjustedPunch = punchMin
    if (punchMin < startMin && punchMin <= endMin) adjustedPunch = punchMin + 24 * 60
    const adjustedEnd = endMin + 24 * 60
    const mid = (startMin + adjustedEnd) / 2
    return adjustedPunch < mid ? 'in' : 'out'
  }

  const distStart = Math.abs(punchMin - startMin)
  const distEnd = Math.abs(punchMin - endMin)
  if (distStart === distEnd) {
    const mid = (startMin + endMin) / 2
    return punchMin < mid ? 'in' : 'out'
  }
  return distStart < distEnd ? 'in' : 'out'
}

function punchRole(p: PunchLike, shift?: ShiftResolveLike | null, tz = 'Asia/Karachi'): 'in' | 'out' {
  if (p.punch_type === 'in') return 'in'
  if (p.punch_type === 'out') return 'out'
  return classifyPunchByShift(p.punch_at, shift, tz)
}

export function nextDateIso(dateStr: string): string {
  const [y, mo, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, mo - 1, d + 1)).toISOString().slice(0, 10)
}

/** Today's date in company timezone (YYYY-MM-DD). Avoid UTC `toISOString()` for attendance dates. */
export function todayInCompanyTz(tz = 'Asia/Karachi'): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: tz })
}

/** Local calendar date for a punch in company timezone (default Asia/Karachi). */
export function punchOnDate(punchAt: string, dateStr: string, tz = 'Asia/Karachi'): boolean {
  const local = new Date(punchAt).toLocaleDateString('en-CA', { timeZone: tz })
  return local === dateStr
}

/**
 * Derive first IN / last OUT from punches.
 * Explicit in/out from device is kept; auto punches are classified by shift window.
 */
export function resolveInOutFromPunches(
  punches: PunchLike[],
  options?: { shift?: ShiftResolveLike | null; tz?: string }
): {
  first_in: string | null
  last_out: string | null
} {
  if (!punches.length) return { first_in: null, last_out: null }

  const shift = options?.shift
  const tz = options?.tz ?? 'Asia/Karachi'
  const sorted = [...punches].sort(
    (a, b) => new Date(a.punch_at).getTime() - new Date(b.punch_at).getTime()
  )

  const ins = sorted.filter((p) => punchRole(p, shift, tz) === 'in')
  const outs = sorted.filter((p) => punchRole(p, shift, tz) === 'out')

  const first_in = ins.length ? ins[0].punch_at : null
  let last_out = outs.length ? outs[outs.length - 1].punch_at : null

  // Fallback: if no explicit OUT is classified, but we have multiple punches and a first_in,
  // treat the latest punch that is after first_in as the last_out.
  if (!last_out && first_in && sorted.length > 1) {
    const lastPunch = sorted[sorted.length - 1].punch_at
    if (lastPunch !== first_in) {
      last_out = lastPunch
    }
  }

  return {
    first_in,
    last_out,
  }
}

export type AttendancePeriodStats = {
  presentDays: number
  absentDays: number
  leaveDays: number
  workingDays: number
  presentPct: number
  absentPct: number
  leavePct: number
}

/** Present / absent / leave share of working days (excludes holiday & weekly off). */
export function computeAttendancePeriodStats(
  rows: { status: string }[]
): AttendancePeriodStats {
  let presentDays = 0
  let absentDays = 0
  let leaveDays = 0
  let workingDays = 0

  for (const row of rows) {
    const status = row.status
    if (status === 'Holiday' || status === 'Weekly Off') continue
    workingDays += 1
    if (status === 'Present' || status === 'Late') presentDays += 1
    else if (status === 'Half Day') presentDays += 0.5
    else if (status === 'Absent') absentDays += 1
    else if (status === 'Leave') leaveDays += 1
  }

  const pct = (value: number) =>
    workingDays > 0 ? Math.round((value / workingDays) * 1000) / 10 : 0

  return {
    presentDays,
    absentDays,
    leaveDays,
    workingDays,
    presentPct: pct(presentDays),
    absentPct: pct(absentDays),
    leavePct: pct(leaveDays),
  }
}

export function monthStartIso(dateIso: string): string {
  return `${dateIso.slice(0, 7)}-01`
}

export function yearStartIso(dateIso: string): string {
  return `${dateIso.slice(0, 4)}-01-01`
}
