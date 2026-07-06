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

      const [empRes, dailyRes] = await Promise.all([
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

      const todayRow = rows.find((row) => row.attendance_date === todayIso)
      setTodayStatus(getLiveDisplayStatus(todayRow ?? null))

      setMonthlyStats(
        computeAttendancePeriodStats(rows.filter((row) => row.attendance_date >= monthStart))
      )
      setAnnualStats(computeAttendancePeriodStats(rows))
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

          <AttendanceTimeline rows={dailyRows} />

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
