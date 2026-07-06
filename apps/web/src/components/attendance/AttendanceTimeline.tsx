import { useMemo } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Clock, Calendar, CheckCircle2, AlertCircle, HelpCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getLiveDisplayStatus } from '@/lib/liveAttendance'

export interface DailyAttendanceRow {
  attendance_date: string
  status: string
  first_in: string | null
  last_out: string | null
  is_holiday: boolean
  is_weekly_off: boolean
  scheduled_start: string | null
  scheduled_end: string | null
  worked_minutes: number
  late_minutes: number
  early_out_minutes: number
  overtime_minutes: number
  shifts?: {
    code: string
    name: string
    start_time?: string
    end_time?: string
    grace_late_minutes?: number
    grace_early_minutes?: number
    is_night?: boolean
  } | null
}

interface AttendanceTimelineProps {
  rows: DailyAttendanceRow[]
  limit?: number
}

function formatTimeInPk(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleTimeString('en-PK', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Karachi',
    })
  } catch (e) {
    return new Date(iso).toLocaleTimeString('en-PK', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    })
  }
}

function formatDateInPk(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  if (!y || !m || !d) return dateStr
  // Use UTC to avoid timezone issues shifting the day back/forward
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.toLocaleDateString('en-PK', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
  })
}

function fmtMinutes(mins: number): string {
  if (!mins) return '0m'
  const h = Math.floor(mins / 60)
  const m = Math.round(mins % 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function getRecentDatesInPk(limit: number): string[] {
  const dates: string[] = []
  const now = new Date()
  for (let i = 0; i < limit; i++) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000)
    const dateStr = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' })
    dates.push(dateStr)
  }
  return dates
}

export function AttendanceTimeline({ rows, limit = 7 }: AttendanceTimelineProps) {
  const recentRows = useMemo(() => {
    const dates = getRecentDatesInPk(limit)
    return dates.map((dateStr) => {
      const existing = rows.find((r) => r.attendance_date === dateStr)
      if (existing) return existing
      return {
        attendance_date: dateStr,
        status: 'Absent',
        first_in: null,
        last_out: null,
        is_holiday: false,
        is_weekly_off: false,
        worked_minutes: 0,
        late_minutes: 0,
        early_out_minutes: 0,
        overtime_minutes: 0,
        scheduled_start: null,
        scheduled_end: null,
      }
    })
  }, [rows, limit])

  const renderTimelineBar = (row: DailyAttendanceRow) => {
    const status = row.status
    const isSpecialDay = row.is_holiday || row.is_weekly_off || ['Leave', 'Holiday', 'Weekly Off', 'Absent'].includes(status)
    const hasPunches = !!row.first_in

    // 1. If it's a non-working day, show a simple descriptive track
    if (isSpecialDay && !hasPunches) {
      let label = status
      let bgClass = 'bg-slate-100 dark:bg-slate-800 text-slate-500'
      if (row.is_holiday || status === 'Holiday') {
        label = 'Holiday'
        bgClass = 'bg-amber-50 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400 border border-amber-200/30'
      } else if (row.is_weekly_off || status === 'Weekly Off') {
        label = 'Weekly Off'
        bgClass = 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200/20'
      } else if (status === 'Leave') {
        label = 'On Leave'
        bgClass = 'bg-violet-50 dark:bg-violet-950/20 text-violet-600 dark:text-violet-400 border border-violet-200/30'
      } else if (status === 'Absent') {
        label = 'Absent'
        bgClass = 'bg-rose-50 dark:bg-rose-950/20 text-rose-600 dark:text-rose-400 border border-rose-200/30'
      }

      return (
        <div className={cn("w-full h-8 rounded-lg flex items-center justify-center text-xs font-medium tracking-wide uppercase shadow-sm", bgClass)}>
          {label}
        </div>
      )
    }

    // 2. If no scheduled start/end is available, show simple info
    if (!row.scheduled_start || !row.scheduled_end) {
      if (hasPunches) {
        return (
          <div className="w-full h-8 bg-teal-50 dark:bg-teal-950/20 text-teal-700 dark:text-teal-400 border border-teal-200/30 rounded-lg flex items-center justify-between px-4 text-xs font-medium">
            <span>First In: {formatTimeInPk(row.first_in)}</span>
            <span>Last Out: {formatTimeInPk(row.last_out)}</span>
            <span>Worked: {fmtMinutes(row.worked_minutes)}</span>
          </div>
        )
      }
      return (
        <div className="w-full h-8 bg-slate-100 dark:bg-slate-800 text-slate-400 rounded-lg flex items-center justify-center text-xs">
          No schedule details available
        </div>
      )
    }

    // 3. Render comparison timeline
    const sStart = new Date(row.scheduled_start).getTime()
    const sEnd = new Date(row.scheduled_end).getTime()
    const aIn = row.first_in ? new Date(row.first_in).getTime() : null
    const aOut = row.last_out ? new Date(row.last_out).getTime() : null

    // Determine the timeline's display range
    const shiftDuration = sEnd - sStart
    const marginMs = Math.max(90 * 60 * 1000, shiftDuration * 0.15) // Dynamic margin (min 1.5h)
    
    let tMin = sStart - marginMs
    let tMax = sEnd + marginMs

    if (aIn !== null && aIn < tMin) {
      tMin = aIn - 30 * 60 * 1000
    }
    if (aOut !== null && aOut > tMax) {
      tMax = aOut + 30 * 60 * 1000
    }

    const range = tMax - tMin
    const getPct = (timeMs: number) => Math.max(0, Math.min(100, ((timeMs - tMin) / range) * 100))

    const sStartPct = getPct(sStart)
    const sEndPct = getPct(sEnd)
    const aInPct = aIn !== null ? getPct(aIn) : null
    const aOutPct = aOut !== null ? getPct(aOut) : null

    // Lateness calculations
    const isLate = row.late_minutes > 0
    const isEarlyIn = aIn !== null && aIn < sStart
    const isEarlyOut = row.early_out_minutes > 0
    const isOvertime = row.overtime_minutes > 0

    return (
      <div className="relative w-full h-16 flex flex-col justify-center">
        {/* Top Guidelines: Shift Times */}
        <div className="absolute top-0 left-0 right-0 h-4 text-[9px] text-muted-foreground font-mono select-none">
          <span 
            className="absolute -translate-x-1/2 flex flex-col items-center" 
            style={{ left: `${sStartPct}%` }}
          >
            <span>Shift Start</span>
            <span className="font-bold text-foreground/80">{formatTimeInPk(row.scheduled_start)}</span>
          </span>
          <span 
            className="absolute -translate-x-1/2 flex flex-col items-center" 
            style={{ left: `${sEndPct}%` }}
          >
            <span>Shift End</span>
            <span className="font-bold text-foreground/80">{formatTimeInPk(row.scheduled_end)}</span>
          </span>
        </div>

        {/* Central Bar Container */}
        <div className="relative w-full h-5 my-4 bg-slate-100 dark:bg-slate-800/60 rounded-full border border-slate-200/50 dark:border-slate-800/50 shadow-inner flex items-center overflow-visible">
          {/* Scheduled Shift Window Highlight */}
          <div 
            className="absolute h-full bg-slate-200/40 dark:bg-slate-700/25 border-l border-r border-dashed border-slate-400/80 dark:border-slate-500/80"
            style={{ 
              left: `${sStartPct}%`, 
              width: `${sEndPct - sStartPct}%` 
            }}
          />

          {/* Late Check-in highlight (Red segment between Shift Start and Actual Check-in) */}
          {isLate && aInPct !== null && (
            <div 
              className="absolute h-3 bg-red-500/30 dark:bg-red-500/20 border-t border-b border-red-500/40"
              style={{ 
                left: `${sStartPct}%`, 
                width: `${aInPct - sStartPct}%` 
              }}
              title={`Late: ${row.late_minutes} min`}
            />
          )}

          {/* Early Check-in highlight (Emerald segment between Actual In and Shift Start) */}
          {isEarlyIn && aInPct !== null && (
            <div 
              className="absolute h-3 bg-emerald-500/20 dark:bg-emerald-500/10 border-t border-b border-emerald-500/20"
              style={{ 
                left: `${aInPct}%`, 
                width: `${sStartPct - aInPct}%` 
              }}
              title="Early check-in"
            />
          )}

          {/* Early Out highlight (Orange segment between Actual Out and Shift End) */}
          {isEarlyOut && aOutPct !== null && (
            <div 
              className="absolute h-3 bg-orange-500/30 dark:bg-orange-500/20 border-t border-b border-orange-500/40"
              style={{ 
                left: `${aOutPct}%`, 
                width: `${sEndPct - aOutPct}%` 
              }}
              title={`Early Out: ${row.early_out_minutes} min`}
            />
          )}

          {/* Overtime highlight (Blue/Teal segment between Shift End and Actual Out) */}
          {isOvertime && aOutPct !== null && (
            <div 
              className="absolute h-3 bg-sky-500/30 dark:bg-sky-500/20 border-t border-b border-sky-500/40"
              style={{ 
                left: `${sEndPct}%`, 
                width: `${aOutPct - sEndPct}%` 
              }}
              title={`Overtime: ${row.overtime_minutes} min`}
            />
          )}

          {/* Actual Presence Pill */}
          {aInPct !== null && (
            <div 
              className={cn(
                "absolute h-3 rounded-full shadow-sm",
                isLate || isEarlyOut 
                  ? "bg-gradient-to-r from-amber-500 to-orange-500 dark:from-amber-600 dark:to-orange-600"
                  : "bg-gradient-to-r from-emerald-500 to-teal-500 dark:from-emerald-600 dark:to-teal-600"
              )}
              style={{ 
                left: `${aInPct}%`, 
                width: `${aOutPct !== null ? Math.max(1.5, aOutPct - aInPct) : (100 - aInPct)}%` 
              }}
            />
          )}

          {/* Guidelines inside the bar */}
          <div className="absolute h-full w-[1px] bg-slate-300 dark:bg-slate-600/80 left-[sStartPct]%" style={{ left: `${sStartPct}%` }} />
          <div className="absolute h-full w-[1px] bg-slate-300 dark:bg-slate-600/80 left-[sEndPct]%" style={{ left: `${sEndPct}%` }} />

          {/* In and Out Punch Markers (Pins) */}
          {aInPct !== null && (
            <div 
              className="absolute w-3.5 h-3.5 rounded-full bg-emerald-600 dark:bg-emerald-500 border-2 border-white dark:border-slate-900 shadow -ml-[7px] cursor-pointer"
              style={{ left: `${aInPct}%` }}
              title={`Clocked In: ${formatTimeInPk(row.first_in)}`}
            />
          )}
          {aOutPct !== null && (
            <div 
              className="absolute w-3.5 h-3.5 rounded-full bg-teal-600 dark:bg-teal-500 border-2 border-white dark:border-slate-900 shadow -ml-[7px] cursor-pointer"
              style={{ left: `${aOutPct}%` }}
              title={`Clocked Out: ${formatTimeInPk(row.last_out)}`}
            />
          )}
        </div>

        {/* Bottom Guidelines: Actual Punch Times & Status labels */}
        <div className="absolute bottom-0 left-0 right-0 h-4 text-[9px] font-mono select-none">
          {aInPct !== null && (
            <span 
              className="absolute -translate-x-1/2 flex flex-col items-center text-emerald-600 dark:text-emerald-400 font-semibold" 
              style={{ left: `${aInPct}%` }}
            >
              <span className="leading-none">IN</span>
              <span>{formatTimeInPk(row.first_in)}</span>
            </span>
          )}
          {aOutPct !== null && (
            <span 
              className="absolute -translate-x-1/2 flex flex-col items-center text-teal-600 dark:text-teal-400 font-semibold" 
              style={{ left: `${aOutPct}%` }}
            >
              <span className="leading-none">OUT</span>
              <span>{formatTimeInPk(row.last_out)}</span>
            </span>
          )}
        </div>
      </div>
    )
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Present':
        return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20'
      case 'Late':
        return 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20'
      case 'Half Day':
        return 'bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20'
      case 'Absent':
        return 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20'
      case 'Leave':
        return 'bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/20'
      default:
        return 'bg-slate-500/10 text-slate-700 dark:text-slate-400 border-slate-500/20'
    }
  }

  return (
    <Card className="shadow-sm border-slate-200/80 dark:border-slate-800">
      <CardHeader className="pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <Clock className="h-5 w-5 text-orange-500" />
              Shift Timeline Comparison
            </CardTitle>
            <CardDescription className="text-xs">
              Visual breakdown of scheduled shifts vs. actual punches for the last {recentRows.length} days.
            </CardDescription>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap items-center gap-3 text-[10px] font-medium text-muted-foreground pt-1 sm:pt-0">
            <div className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 bg-slate-200/80 dark:bg-slate-700/40 border border-slate-300 dark:border-slate-600 rounded-sm" />
              <span>Shift Window</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 bg-gradient-to-r from-emerald-500 to-teal-500 rounded-sm" />
              <span>Worked Hours</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 bg-red-500/30 border border-red-500/40 rounded-sm" />
              <span>Lateness</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 bg-orange-500/30 border border-orange-500/40 rounded-sm" />
              <span>Early Out</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 bg-sky-500/30 border border-sky-500/40 rounded-sm" />
              <span>Overtime</span>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0 sm:px-6 sm:pb-6">
        {recentRows.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
            <AlertCircle className="h-8 w-8 text-muted-foreground/60" />
            No recent attendance records found.
          </div>
        ) : (
          <div className="overflow-x-auto w-full pb-2">
            <div className="divide-y divide-slate-100 dark:divide-slate-800 min-w-[850px] px-4 sm:px-0">
              {recentRows.map((row) => (
                <div 
                  key={row.attendance_date} 
                  className="py-4 first:pt-0 last:pb-0 flex flex-row items-center gap-6"
                >
                  {/* 1. Date & Status Info */}
                  <div className="flex items-center gap-3 w-44 shrink-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="text-sm font-semibold tracking-tight text-slate-800 dark:text-slate-200 truncate">
                        {formatDateInPk(row.attendance_date)}
                      </span>
                    </div>
                    <Badge 
                      variant="outline" 
                      className={cn("text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 border shrink-0", getStatusColor(getLiveDisplayStatus(row)))}
                    >
                      {getLiveDisplayStatus(row)}
                    </Badge>
                  </div>

                  {/* 2. Timeline Bar Visualization */}
                  <div className="flex-1 min-w-0">
                    {renderTimelineBar(row)}
                  </div>

                  {/* 3. Daily Metrics Summary */}
                  <div className="w-44 text-xs text-slate-600 dark:text-slate-400 shrink-0 text-right flex flex-col items-end justify-center gap-y-0.5 select-none">
                    {row.first_in ? (
                      <>
                        <div className="flex items-center">
                          <span className="font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
                            {fmtMinutes(row.worked_minutes)}
                          </span>
                          <span className="text-muted-foreground font-light text-[10px] ml-1">worked</span>
                        </div>
                        
                        <div className="flex flex-col items-end gap-y-0.5">
                          {row.late_minutes > 0 && (
                            <span className="text-red-600 dark:text-red-400 font-medium tracking-tight">
                              +{fmtMinutes(row.late_minutes)} late
                            </span>
                          )}
                          {row.early_out_minutes > 0 && (
                            <span className="text-orange-600 dark:text-orange-400 font-medium tracking-tight">
                              -{fmtMinutes(row.early_out_minutes)} early out
                          </span>
                        )}
                        {row.overtime_minutes > 0 && (
                          <span className="text-sky-600 dark:text-sky-400 font-semibold tracking-tight">
                            +{fmtMinutes(row.overtime_minutes)} OT
                          </span>
                        )}
                        {row.late_minutes === 0 && row.early_out_minutes === 0 && (
                          <span className="text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1 text-[10px]">
                            <CheckCircle2 className="h-3 w-3" />
                            On Time
                          </span>
                        )}
                      </div>
                    </>
                  ) : (
                    <span className="text-muted-foreground italic text-[11px]">No active work session</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </CardContent>
    </Card>
  )
}
