export type LiveAttendanceBucket = 'in' | 'out' | 'break' | 'leave' | 'absent'

export type LiveAttendanceDaily = {
  status?: string | null
  first_in?: string | null
  last_out?: string | null
  is_holiday?: boolean | null
  is_weekly_off?: boolean | null
  attendance_date?: string | null
  late_minutes?: number | null
}

export type LiveAttendanceCounts = {
  all: number
  in: number
  out: number
  break: number
  leave: number
  absent: number
}

export type LiveDisplayStatus =
  | 'Present'
  | 'Late'
  | 'Absent'
  | 'Leave'
  | 'Weekly Off'
  | 'Holiday'
  | 'Half Day'

export const liveDisplayStatusClass: Record<LiveDisplayStatus, string> = {
  Present: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300',
  Late: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300',
  Absent: 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300',
  Leave: 'bg-violet-100 text-violet-800 dark:bg-violet-950/50 dark:text-violet-300',
  'Weekly Off': 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  Holiday: 'bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-300',
  'Half Day': 'bg-orange-100 text-orange-800 dark:bg-orange-950/50 dark:text-orange-300',
}

/** Human-readable status for live attendance cards (Present / Absent / Leave, etc.). */
export function getLiveDisplayStatus(d?: LiveAttendanceDaily | null): LiveDisplayStatus {
  if (!d) return 'Absent'

  const status = (d.status ?? '').trim()
  if (status === 'Leave' || status.toLowerCase() === 'leave') return 'Leave'
  if (d.is_holiday || status === 'Holiday') return 'Holiday'
  if (d.is_weekly_off || status === 'Weekly Off') return 'Weekly Off'
  if (status === 'Half Day') return 'Half Day'

  // If this is a record for today, and they have checked in, display them as Present/Late
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' })
  const isToday = d.attendance_date === today

  const isLate = status === 'Late' || (typeof d.late_minutes === 'number' && d.late_minutes > 0)

  if (isToday && d.first_in) {
    return isLate ? 'Late' : 'Present'
  }

  // Otherwise (for past days or if they haven't checked in today), trust the status or fallback to Absent
  if (isLate) return 'Late'
  if (status === 'Present') return 'Present'
  if (status === 'Absent') return 'Absent'

  return d.first_in ? (isLate ? 'Late' : 'Present') : 'Absent'
}

/** Classify today's attendance for live board (in / out / leave / absent / break). */
export function classifyLiveAttendance(d?: LiveAttendanceDaily | null): LiveAttendanceBucket {
  if (!d) return 'absent'

  const status = (d.status ?? '').trim()
  if (status === 'Leave' || status.toLowerCase() === 'leave') return 'leave'
  if (d.is_holiday || status === 'Holiday') return 'leave'
  if (d.is_weekly_off || status === 'Weekly Off') return 'leave'

  if (status === 'Half Day') return 'break'

  if (d.first_in && !d.last_out) return 'in'
  if (d.first_in && d.last_out) return 'out'

  if (status === 'Absent' || !d.first_in) return 'absent'
  if (['Present', 'Late'].includes(status)) {
    return d.last_out ? 'out' : d.first_in ? 'in' : 'absent'
  }

  return 'absent'
}

export function countLiveAttendance(
  employeeIds: string[],
  dailyByEmployee: Map<string, LiveAttendanceDaily>
): LiveAttendanceCounts {
  const counts: LiveAttendanceCounts = { all: employeeIds.length, in: 0, out: 0, break: 0, leave: 0, absent: 0 }
  for (const id of employeeIds) {
    const bucket = classifyLiveAttendance(dailyByEmployee.get(id))
    counts[bucket] += 1
  }
  return counts
}

export const liveBucketLabels: Record<LiveAttendanceBucket | 'all', string> = {
  all: 'All',
  in: 'In',
  out: 'Out',
  break: 'On break',
  leave: 'Leave',
  absent: 'Absent',
}
