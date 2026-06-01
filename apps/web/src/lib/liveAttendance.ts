export type LiveAttendanceBucket = 'in' | 'out' | 'break' | 'leave' | 'absent'

export type LiveAttendanceDaily = {
  status?: string | null
  first_in?: string | null
  last_out?: string | null
  is_holiday?: boolean | null
  is_weekly_off?: boolean | null
}

export type LiveAttendanceCounts = {
  all: number
  in: number
  out: number
  break: number
  leave: number
  absent: number
}

/** Classify today's attendance for live board (in / out / leave / absent / break). */
export function classifyLiveAttendance(d?: LiveAttendanceDaily | null): LiveAttendanceBucket {
  if (!d) return 'absent'

  const status = (d.status ?? '').trim()
  if (status === 'Leave' || status.toLowerCase().includes('leave')) return 'leave'
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
