import { cn } from '@/lib/utils'
import type { AttendancePeriodStats } from '@/lib/attendance'

const SEGMENTS = [
  { key: 'present', label: 'Present', color: '#14b8a6', text: 'text-teal-700' },
  { key: 'absent', label: 'Absent', color: '#ef4444', text: 'text-red-700' },
  { key: 'leave', label: 'Leave', color: '#8b5cf6', text: 'text-violet-700' },
] as const

function segmentDays(stats: AttendancePeriodStats, key: (typeof SEGMENTS)[number]['key']) {
  if (key === 'present') return stats.presentDays
  if (key === 'absent') return stats.absentDays
  return stats.leaveDays
}

function segmentPct(stats: AttendancePeriodStats, key: (typeof SEGMENTS)[number]['key']) {
  if (key === 'present') return stats.presentPct
  if (key === 'absent') return stats.absentPct
  return stats.leavePct
}

function donutGradient(stats: AttendancePeriodStats): string {
  if (stats.workingDays <= 0) return 'conic-gradient(#e2e8f0 0deg 360deg)'

  let angle = 0
  const stops: string[] = []
  for (const seg of SEGMENTS) {
    const days = segmentDays(stats, seg.key)
    if (days <= 0) continue
    const sweep = (days / stats.workingDays) * 360
    if (sweep <= 0) continue
    const end = angle + sweep
    stops.push(`${seg.color} ${angle}deg ${end}deg`)
    angle = end
  }
  if (angle < 360) stops.push(`#e2e8f0 ${angle}deg 360deg`)
  return `conic-gradient(${stops.join(', ')})`
}

export function AttendanceDonutChart({
  stats,
  className,
}: {
  stats: AttendancePeriodStats
  className?: string
}) {
  return (
    <div className={cn('flex flex-col sm:flex-row items-center gap-6', className)}>
      <div className="relative h-44 w-44 shrink-0">
        <div
          className="h-full w-full rounded-full shadow-inner"
          style={{ background: donutGradient(stats) }}
          role="img"
          aria-label="Attendance breakdown chart"
        />
        <div className="absolute inset-[18%] rounded-full bg-card border flex flex-col items-center justify-center text-center px-2">
          <span className="text-2xl font-bold tabular-nums leading-none">{stats.workingDays}</span>
          <span className="text-[11px] text-muted-foreground mt-1">working days</span>
        </div>
      </div>

      <div className="flex-1 w-full space-y-3 min-w-[10rem]">
        {SEGMENTS.map((seg) => {
          const days = segmentDays(stats, seg.key)
          const pct = segmentPct(stats, seg.key)
          return (
            <div key={seg.key} className="flex items-center gap-3">
              <span
                className="h-3 w-3 rounded-full shrink-0"
                style={{ backgroundColor: seg.color }}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-medium">{seg.label}</span>
                  <span className={cn('font-semibold tabular-nums', seg.text)}>{pct}%</span>
                </div>
                <div className="text-xs text-muted-foreground tabular-nums">
                  {days % 1 === 0 ? days : days.toFixed(1)} day{days === 1 ? '' : 's'}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
