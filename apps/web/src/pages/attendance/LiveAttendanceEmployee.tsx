import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { PageHeader } from '@/components/master/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { AttendanceDonutChart } from '@/components/attendance/AttendanceDonutChart'
import { AttendanceTimeline, type DailyAttendanceRow } from '@/components/attendance/AttendanceTimeline'
import { avatarColorFor, cn, initialsFromName } from '@/lib/utils'
import {
  computeAttendancePeriodStats,
  monthStartIso,
  todayInCompanyTz,
  yearStartIso,
  type AttendancePeriodStats,
} from '@/lib/attendance'
import { getLiveDisplayStatus, liveDisplayStatusClass, type LiveDisplayStatus } from '@/lib/liveAttendance'
import { toast } from 'sonner'

const emptyStats = (): AttendancePeriodStats => ({
  presentDays: 0,
  absentDays: 0,
  leaveDays: 0,
  workingDays: 0,
  presentPct: 0,
  absentPct: 0,
  leavePct: 0,
  lateDays: 0,
  latePct: 0,
})

function getDatesInRange(startIso: string, endIso: string): string[] {
  const dates: string[] = []
  const start = new Date(startIso + 'T12:00:00')
  const end = new Date(endIso + 'T12:00:00')

  const current = new Date(start)
  while (current <= end) {
    const y = current.getFullYear()
    const m = String(current.getMonth() + 1).padStart(2, '0')
    const d = String(current.getDate()).padStart(2, '0')
    dates.push(`${y}-${m}-${d}`)
    current.setDate(current.getDate() + 1)
  }
  return dates
}

function fillMissingDays(
  existingRows: DailyAttendanceRow[],
  startIso: string,
  endIso: string,
  weeklyOffDays: string[]
): DailyAttendanceRow[] {
  const dates = getDatesInRange(startIso, endIso)
  return dates.map((dateStr) => {
    const existing = existingRows.find((r) => r.attendance_date === dateStr)
    if (existing) return existing

    const [y, m, d] = dateStr.split('-').map(Number)
    const date = new Date(Date.UTC(y, m - 1, d))
    const weekday = date.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
    const isWeeklyOff = weeklyOffDays.includes(weekday)

    return {
      attendance_date: dateStr,
      status: isWeeklyOff ? 'Weekly Off' : 'Absent',
      first_in: null,
      last_out: null,
      is_holiday: false,
      is_weekly_off: isWeeklyOff,
      worked_minutes: 0,
      late_minutes: 0,
      early_out_minutes: 0,
      overtime_minutes: 0,
      scheduled_start: null,
      scheduled_end: null,
    } as DailyAttendanceRow
  })
}

type Employee = {
  id: string
  employee_code: string
  full_name: string
  photo_url: string | null
  branches: { name: string } | null
}

export function LiveAttendanceEmployeePage() {
  const { employeeId } = useParams<{ employeeId: string }>()
  const navigate = useNavigate()
  const todayIso = useMemo(() => todayInCompanyTz(), [])
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [todayStatus, setTodayStatus] = useState<LiveDisplayStatus>('Absent')
  const [loading, setLoading] = useState(true)
  const [monthlyStats, setMonthlyStats] = useState<AttendancePeriodStats>(emptyStats)
  const [annualStats, setAnnualStats] = useState<AttendancePeriodStats>(emptyStats)
  const [weeklyOffDays, setWeeklyOffDays] = useState<string[]>(['Sunday'])
  const [dailyRows, setDailyRows] = useState<DailyAttendanceRow[]>([])

  const monthLabel = useMemo(
    () =>
      new Date(`${todayIso}T12:00:00`).toLocaleDateString('en-PK', {
        month: 'long',
        year: 'numeric',
      }),
    [todayIso]
  )
  const yearLabel = todayIso.slice(0, 4)

  useEffect(() => {
    if (!employeeId) return
    void (async () => {
      setLoading(true)
      const yearStart = yearStartIso(todayIso)
      const monthStart = monthStartIso(todayIso)

      const [empRes, dailyRes, shiftRes] = await Promise.all([
        supabase
          .from('employees')
          .select('id, employee_code, full_name, photo_url, branches(name)')
          .eq('id', employeeId)
          .single(),
        supabase
          .from('attendance_daily')
          .select('attendance_date, status, first_in, last_out, is_holiday, is_weekly_off, scheduled_start, scheduled_end, worked_minutes, late_minutes, early_out_minutes, overtime_minutes, shifts(code, name, start_time, end_time, grace_late_minutes, grace_early_minutes, is_night)')
          .eq('employee_id', employeeId)
          .gte('attendance_date', yearStart)
          .lte('attendance_date', todayIso),
        supabase
          .from('employee_shift_assignments')
          .select('weekly_off, effective_from, effective_to')
          .eq('employee_id', employeeId),
      ])

      if (empRes.error || !empRes.data) {
        toast.error('Employee not found')
        navigate('/attendance/live')
        return
      }

      const b = empRes.data.branches
      setEmployee({
        id: empRes.data.id,
        employee_code: empRes.data.employee_code,
        full_name: empRes.data.full_name,
        photo_url: empRes.data.photo_url,
        branches: Array.isArray(b) ? (b[0] as { name: string }) : (b as { name: string } | null),
      })

      const rawRows = dailyRes.data ?? []
      const rows = rawRows.map((r: any) => {
        const sh = r.shifts
        return {
          ...r,
          shifts: Array.isArray(sh) ? sh[0] : sh ?? null,
        }
      }) as DailyAttendanceRow[]

      setDailyRows(rows)

      const assignments = shiftRes.data ?? []
      const activeAssignment = assignments
        .filter((a: any) => {
          const from = a.effective_from
          const to = a.effective_to
          return from <= todayIso && (!to || to >= todayIso)
        })
        .sort((a: any, b: any) => b.effective_from.localeCompare(a.effective_from))[0]

      if (activeAssignment?.weekly_off) {
        setWeeklyOffDays(activeAssignment.weekly_off)
      }

      const todayRow = rows.find((row) => row.attendance_date === todayIso)
      setTodayStatus(getLiveDisplayStatus(todayRow ?? null))

      const activeWeeklyOff = activeAssignment?.weekly_off ?? ['Sunday']
      const fullMonthRows = fillMissingDays(rows, monthStart, todayIso, activeWeeklyOff)
      const fullYearRows = fillMissingDays(rows, yearStart, todayIso, activeWeeklyOff)

      setMonthlyStats(computeAttendancePeriodStats(fullMonthRows))
      setAnnualStats(computeAttendancePeriodStats(fullYearRows))
      setLoading(false)
    })()
  }, [employeeId, navigate, todayIso])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance summary"
        description="Monthly and yearly present, absent, and leave breakdown."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/attendance/live">
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              Live board
            </Link>
          </Button>
        }
      />

      {loading ? (
        <div className="py-24 grid place-items-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : employee ? (
        <>
          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-wrap items-center gap-4">
                <Avatar
                  className={cn('h-16 w-16 text-lg font-semibold shrink-0', avatarColorFor(employee.full_name))}
                >
                  {employee.photo_url && <AvatarImage src={employee.photo_url} alt={employee.full_name} />}
                  <AvatarFallback className="bg-transparent text-inherit">
                    {initialsFromName(employee.full_name)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <h2 className="text-xl font-semibold leading-tight">{employee.full_name}</h2>
                  <p className="text-sm text-muted-foreground font-mono mt-0.5">{employee.employee_code}</p>
                  <p className="text-sm text-muted-foreground">{employee.branches?.name ?? 'No branch'}</p>
                </div>
                <div className="flex flex-col items-start sm:items-end gap-2">
                  <span
                    className={cn(
                      'text-[10px] uppercase tracking-wide font-semibold px-2.5 py-1 rounded',
                      liveDisplayStatusClass[todayStatus]
                    )}
                  >
                    Today: {todayStatus}
                  </span>
                  <Button variant="outline" size="sm" asChild>
                    <Link to={`/employees/${employee.id}`}>Open employee profile</Link>
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <AttendanceTimeline rows={dailyRows} weeklyOffDays={weeklyOffDays} />

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">This month</CardTitle>
                <CardDescription>{monthLabel} · working days only (excludes holiday & weekly off)</CardDescription>
              </CardHeader>
              <CardContent>
                {monthlyStats.workingDays === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">
                    No attendance records for this month yet.
                  </p>
                ) : (
                  <AttendanceDonutChart stats={monthlyStats} />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">This year</CardTitle>
                <CardDescription>
                  Jan–Dec {yearLabel} to date · working days only
                </CardDescription>
              </CardHeader>
              <CardContent>
                {annualStats.workingDays === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">
                    No attendance records for this year yet.
                  </p>
                ) : (
                  <AttendanceDonutChart stats={annualStats} />
                )}
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  )
}
