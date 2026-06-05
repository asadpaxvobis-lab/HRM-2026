import {
  Users,
  Building2,
  AlarmClock,
  CalendarDays,
  CalendarRange,
  Clock,
  Timer,
  Activity,
  FileQuestion,
  Megaphone,
  Pin,
  AlertTriangle,
  Shield,
  Fingerprint,
  ScanFace,
  RefreshCw,
  Search,
  type LucideIcon,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/contexts/AuthContext'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { buildBiometricGaps, type BiometricGapsByDepartment } from '@/lib/biometricGaps'
import { loadAllDevicePinRows } from '@/lib/employeeDevicePin'
import { fetchZktBiometricStatus } from '@/lib/zktAgent'
import {
  countLiveAttendance,
  type LiveAttendanceCounts,
  type LiveAttendanceDaily,
} from '@/lib/liveAttendance'

type Stat = {
  label: string
  value: number | string
  icon: LucideIcon
  hint: string
  to?: string
  perm?: string
  onClick?: () => void
}

export function DashboardPage() {
  const { appUser, roles, permissions, hasPermission } = useAuth()
  const [stats, setStats] = useState({
    employees: '—' as number | string,
    branches: '—' as number | string,
    departments: '—' as number | string,
    designations: '—' as number | string,
    users: '—' as number | string,
    onLeaveToday: '—' as number | string,
    pendingLeave: '—' as number | string,
    pendingCorrections: '—' as number | string,
    upcomingHolidays: '—' as number | string,
    activeDevices: '—' as number | string,
    presentToday: '—' as number | string,
    lateToday: '—' as number | string,
    absentToday: '—' as number | string,
  })
  const [livePunches, setLivePunches] = useState<
    { id: string; name: string; code: string; punch_at: string; source: string }[]
  >([])
  const [onLeaveList, setOnLeaveList] = useState<{ id: string; name: string; type: string; until: string }[]>([])
  const [upcomingHolidays, setUpcomingHolidays] = useState<{ id: string; name: string; date: string }[]>([])
  const [announcements, setAnnouncements] = useState<
    { id: string; title: string; category: string; priority: string; pinned: boolean; published_at: string | null; unread: boolean }[]
  >([])
  const [bioGapsByDept, setBioGapsByDept] = useState<BiometricGapsByDepartment[]>([])
  const [bioLoading, setBioLoading] = useState(false)
  const [bioAgentOffline, setBioAgentOffline] = useState(false)
  const [bioScannedAt, setBioScannedAt] = useState<string | null>(null)
  const [liveCounts, setLiveCounts] = useState<LiveAttendanceCounts>({
    all: 0,
    in: 0,
    out: 0,
    break: 0,
    leave: 0,
    absent: 0,
  })
  const [otTaken, setOtTaken] = useState({ employees: 0, hoursLabel: '0h' })
  const [lateSummary, setLateSummary] = useState({ employees: 0, minutes: 0, days: 0 })
  const [overviewQuery, setOverviewQuery] = useState('')

  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const in30Iso = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() + 30)
    return d.toISOString().slice(0, 10)
  }, [])

  useEffect(() => {
    const load = async () => {
      const attendanceDailyQuery = hasPermission('attendance.view')
        ? supabase.from('attendance_daily').select('status').eq('attendance_date', todayIso)
        : Promise.resolve({ data: [] as { status: string }[] })

      const liveAttendanceQuery = hasPermission('attendance.view')
        ? Promise.all([
            supabase.from('employees').select('id').eq('is_active', true),
            supabase
              .from('attendance_daily')
              .select('employee_id, status, first_in, last_out, is_holiday, is_weekly_off')
              .eq('attendance_date', todayIso),
          ])
        : Promise.resolve([{ data: [] as { id: string }[] }, { data: [] as Record<string, unknown>[] }] as const)

      const [emp, br, dep, desg, us, dev, hol, holList, leaveToday, pendLeave, pendCorr, dailyRows, liveData] =
        await Promise.all([
        supabase.from('employees').select('*', { count: 'exact', head: true }),
        supabase.from('branches').select('*', { count: 'exact', head: true }),
        supabase.from('departments').select('*', { count: 'exact', head: true }),
        supabase.from('designations').select('*', { count: 'exact', head: true }),
        supabase.from('users').select('*', { count: 'exact', head: true }),
        supabase.from('attendance_devices').select('*', { count: 'exact', head: true }).eq('is_active', true),
        supabase
          .from('holidays')
          .select('*', { count: 'exact', head: true })
          .gte('holiday_date', todayIso)
          .lte('holiday_date', in30Iso),
        supabase
          .from('holidays')
          .select('id, name, holiday_date')
          .gte('holiday_date', todayIso)
          .lte('holiday_date', in30Iso)
          .order('holiday_date', { ascending: true })
          .limit(5),
        supabase
          .from('leave_applications')
          .select('id, from_date, to_date, status, employees ( first_name, last_name ), leave_types ( name )')
          .lte('from_date', todayIso)
          .gte('to_date', todayIso)
          .eq('status', 'APPROVED')
          .limit(8),
        supabase
          .from('leave_applications')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'PENDING'),
        supabase
          .from('attendance_corrections')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'PENDING'),
        attendanceDailyQuery,
        liveAttendanceQuery,
      ])

      if (hasPermission('attendance.view')) {
        const [empRows, dailyLive] = liveData as [
          { data: { id: string }[] | null },
          { data: Record<string, unknown>[] | null },
        ]
        const dailyMap = new Map<string, Record<string, unknown>>()
        for (const row of dailyLive.data ?? []) {
          dailyMap.set(row.employee_id as string, row)
        }
        setLiveCounts(
          countLiveAttendance(
            (empRows.data ?? []).map((e) => e.id),
            dailyMap as Map<string, LiveAttendanceDaily>
          )
        )
      }

      if (hasPermission('overtime.view')) {
        const monthStart = `${todayIso.slice(0, 8)}01`
        const [{ data: dailyOt }, { data: otReqs }] = await Promise.all([
          supabase
            .from('attendance_daily')
            .select('employee_id, overtime_minutes')
            .gte('attendance_date', monthStart)
            .lte('attendance_date', todayIso)
            .gt('overtime_minutes', 0),
          supabase
            .from('overtime_requests')
            .select('employee_id, planned_hours, actual_hours')
            .gte('ot_date', monthStart)
            .lte('ot_date', todayIso)
            .in('status', ['PENDING', 'APPROVED', 'PAID']),
        ])
        const withOt = new Set<string>()
        let totalMinutes = 0
        for (const d of dailyOt ?? []) {
          withOt.add(d.employee_id as string)
          totalMinutes += Number(d.overtime_minutes ?? 0)
        }
        for (const r of otReqs ?? []) {
          withOt.add(r.employee_id as string)
          totalMinutes += Math.round(Number(r.actual_hours ?? r.planned_hours ?? 0) * 60)
        }
        const hours = Math.round((totalMinutes / 60) * 10) / 10
        setOtTaken({
          employees: withOt.size,
          hoursLabel: `${hours}h this month`,
        })
      }

      if (hasPermission('attendance.view')) {
        const monthStart = `${todayIso.slice(0, 8)}01`
        const { data: lateDaily } = await supabase
          .from('attendance_daily')
          .select('employee_id, late_minutes, status, first_in, last_out')
          .gte('attendance_date', monthStart)
          .lte('attendance_date', todayIso)

        const lateEmps = new Set<string>()
        let lateMinutes = 0
        let lateDays = 0
        for (const d of lateDaily ?? []) {
          if (!d.first_in || !d.last_out) continue
          const mins = Number(d.late_minutes ?? 0)
          const status = (d.status as string | null) ?? ''
          if (mins > 0 || status === 'Late' || status.toLowerCase().includes('late')) {
            lateEmps.add(d.employee_id as string)
            lateDays += 1
            lateMinutes += mins
          }
        }
        setLateSummary({ employees: lateEmps.size, minutes: lateMinutes, days: lateDays })
      }

      const daily = (dailyRows.data ?? []) as { status: string }[]
      const presentCount = daily.filter((d) => d.status === 'Present' || d.status === 'Late').length
      const lateCount = daily.filter((d) => d.status === 'Late').length
      const absentCount = daily.filter((d) => d.status === 'Absent').length

      setStats({
        employees: emp.count ?? 0,
        branches: br.count ?? 0,
        departments: dep.count ?? 0,
        designations: desg.count ?? 0,
        users: us.count ?? 0,
        activeDevices: dev.count ?? 0,
        upcomingHolidays: hol.count ?? 0,
        onLeaveToday: leaveToday.data?.length ?? 0,
        pendingLeave: pendLeave.count ?? 0,
        pendingCorrections: pendCorr.count ?? 0,
        presentToday: hasPermission('attendance.view') ? presentCount : '—',
        lateToday: hasPermission('attendance.view') ? lateCount : '—',
        absentToday: hasPermission('attendance.view') ? absentCount : '—',
      })

      setOnLeaveList(
        (leaveToday.data ?? []).map((r: any) => ({
          id: r.id,
          name: `${r.employees?.first_name ?? ''} ${r.employees?.last_name ?? ''}`.trim() || 'Employee',
          type: r.leave_types?.name ?? 'Leave',
          until: r.to_date,
        }))
      )
      setUpcomingHolidays(
        (holList.data ?? []).map((h: any) => ({ id: h.id, name: h.name, date: h.holiday_date }))
      )

      // Announcements feed (latest 5 published + read state for this user)
      if (hasPermission('announcement.view')) {
        const [{ data: ann }, { data: reads }] = await Promise.all([
          supabase
            .from('announcements')
            .select('id, title, category, priority, pinned, published_at')
            .eq('status', 'PUBLISHED')
            .order('pinned', { ascending: false })
            .order('published_at', { ascending: false, nullsFirst: false })
            .limit(5),
          appUser?.id
            ? supabase.from('announcement_reads').select('announcement_id').eq('user_id', appUser.id)
            : Promise.resolve({ data: [] as { announcement_id: string }[] }),
        ])
        const readSet = new Set((reads ?? []).map((r) => (r as { announcement_id: string }).announcement_id))
        setAnnouncements(
          (ann ?? []).map((a: any) => ({
            id: a.id,
            title: a.title,
            category: a.category,
            priority: a.priority,
            pinned: a.pinned,
            published_at: a.published_at,
            unread: !readSet.has(a.id),
          }))
        )
      }
    }
    void load().catch(() => {})
  }, [todayIso, in30Iso, appUser?.id, hasPermission])

  const loadBiometricGaps = async () => {
    if (!hasPermission('employee.view') || !hasPermission('attendance.view') || !appUser?.company_id) return
    setBioLoading(true)
    try {
      const [empRes, scan] = await Promise.all([
        supabase
          .from('employees')
          .select('id, employee_code, full_name, device_pin, departments(name)')
          .eq('is_active', true)
          .order('full_name'),
        fetchZktBiometricStatus(),
      ])
      const pinRows = await loadAllDevicePinRows(appUser.company_id)
      const employees = (empRes.data ?? []).map((r: Record<string, unknown>) => {
        const dep = r.departments
        const d = Array.isArray(dep) ? (dep[0] as { name: string } | null) : (dep as { name: string } | null)
        return {
          id: r.id as string,
          employee_code: r.employee_code as string,
          full_name: r.full_name as string,
          device_pin: r.device_pin as number | null,
          departments: d,
        }
      })
      const { byDepartment, agentOffline, scannedAt } = buildBiometricGaps(
        employees,
        pinRows.map((p) => ({
          employee_id: p.employee_id,
          device_id: p.device_id,
          device_pin: p.device_pin,
        })),
        scan
      )
      setBioGapsByDept(byDepartment)
      setBioAgentOffline(agentOffline)
      setBioScannedAt(scannedAt)
    } finally {
      setBioLoading(false)
    }
  }

  useEffect(() => {
    void loadBiometricGaps()
  }, [appUser?.company_id, hasPermission])

  const reloadLiveCounts = useCallback(async () => {
    if (!hasPermission('attendance.view')) return
    const [{ data: emps }, { data: daily }] = await Promise.all([
      supabase.from('employees').select('id').eq('is_active', true),
      supabase
        .from('attendance_daily')
        .select('employee_id, status, first_in, last_out, is_holiday, is_weekly_off')
        .eq('attendance_date', todayIso),
    ])
    const dailyMap = new Map<string, LiveAttendanceDaily>()
    for (const row of daily ?? []) {
      dailyMap.set(row.employee_id as string, row as LiveAttendanceDaily)
    }
    setLiveCounts(countLiveAttendance((emps ?? []).map((e) => e.id), dailyMap))
  }, [todayIso, hasPermission])

  const loadLivePunches = async () => {
    if (!hasPermission('attendance.view')) return
    const { data } = await supabase
      .from('attendance_punches')
      .select('id, punch_at, source, employees ( full_name, employee_code )')
      .gte('punch_at', `${todayIso}T00:00:00`)
      .order('punch_at', { ascending: false })
      .limit(12)
    setLivePunches(
      (data ?? []).map((r: Record<string, unknown>) => {
        const emp = r.employees as { full_name?: string; employee_code?: string } | { full_name?: string; employee_code?: string }[] | null
        const e = Array.isArray(emp) ? emp[0] : emp
        return {
          id: r.id as string,
          name: e?.full_name ?? 'Employee',
          code: e?.employee_code ?? '',
          punch_at: r.punch_at as string,
          source: r.source as string,
        }
      })
    )
  }

  useEffect(() => {
    if (!hasPermission('attendance.view')) return
    void loadLivePunches()

    const channel = supabase
      .channel('dashboard-attendance-live')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'attendance_punches' },
        () => {
          void loadLivePunches()
          void reloadLiveCounts()
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'attendance_daily', filter: `attendance_date=eq.${todayIso}` },
        async () => {
          const { data } = await supabase.from('attendance_daily').select('status').eq('attendance_date', todayIso)
          const daily = (data ?? []) as { status: string }[]
          setStats((s) => ({
            ...s,
            presentToday: daily.filter((d) => d.status === 'Present' || d.status === 'Late').length,
            lateToday: daily.filter((d) => d.status === 'Late').length,
            absentToday: daily.filter((d) => d.status === 'Absent').length,
          }))
          void reloadLiveCounts()
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [todayIso, hasPermission, reloadLiveCounts])

  const statTiles: Stat[] = useMemo(() => {
    const tiles: Stat[] = []
    if (hasPermission('attendance.view')) {
      tiles.push({
        label: 'Live attendance',
        value: liveCounts.all,
        icon: Activity,
        hint: `${liveCounts.in} in · ${liveCounts.out} out · ${liveCounts.leave} leave · ${liveCounts.absent} absent`,
        to: '/attendance/live',
      })
    } else if (hasPermission('employee.view')) {
      tiles.push({
        label: 'Employees',
        value: stats.employees,
        icon: Users,
        hint: 'Total in system',
        to: '/employees',
      })
    }
    tiles.push(
    {
      label: 'Overtime',
      value: otTaken.employees,
      icon: Timer,
      hint: otTaken.employees > 0 ? `${otTaken.hoursLabel} · employees with OT` : 'No OT this month',
      to: '/overtime/taken',
      perm: 'overtime.view',
    },
    {
      label: 'Late employees',
      value: lateSummary.employees,
      icon: AlarmClock,
      hint:
        lateSummary.employees > 0
          ? `${lateSummary.days} late day(s) · ${lateSummary.minutes} min this month`
          : 'No late arrivals this month',
      to: '/attendance/late',
      perm: 'attendance.view',
    },
    { label: 'Branches', value: stats.branches, icon: Building2, hint: 'Active locations', to: '/branches', perm: 'branch.view' },
    { label: 'On leave today', value: stats.onLeaveToday, icon: CalendarDays, hint: 'Approved leave', to: '/leave', perm: 'leave.view' },
    { label: 'Pending leave', value: stats.pendingLeave, icon: CalendarDays, hint: 'Awaiting decision', to: '/leave', perm: 'leave.view' },
    { label: 'Pending corrections', value: stats.pendingCorrections, icon: FileQuestion, hint: 'Attendance fixes', to: '/attendance/corrections', perm: 'attendance.view' },
    { label: 'Present today', value: stats.presentToday, icon: Clock, hint: 'Checked in', to: '/attendance', perm: 'attendance.view' },
    { label: 'Late today', value: stats.lateToday, icon: Clock, hint: 'After grace period', to: '/attendance', perm: 'attendance.view' },
    { label: 'Absent today', value: stats.absentToday, icon: Clock, hint: 'No punch yet', to: '/attendance', perm: 'attendance.view' },
    { label: 'Upcoming holidays', value: stats.upcomingHolidays, icon: CalendarRange, hint: 'Next 30 days', to: '/holidays', perm: 'holiday.view' },
    )
    return tiles
  }, [hasPermission, liveCounts, stats, otTaken, lateSummary])

  const visibleStats = statTiles.filter((s) => !s.perm || hasPermission(s.perm))

  const missingBioCount = useMemo(
    () => bioGapsByDept.reduce((n, d) => n + d.rows.length, 0),
    [bioGapsByDept]
  )

  const overviewStats: Stat[] = useMemo(() => {
    const tiles = [...visibleStats]
    if (hasPermission('employee.view') && hasPermission('attendance.view')) {
      tiles.push({
        label: 'Missing biometrics',
        value: bioLoading && bioGapsByDept.length === 0 && !bioAgentOffline ? '…' : missingBioCount,
        icon: Fingerprint,
        hint: bioAgentOffline ? 'Agent offline — refresh' : 'Missing IN / OUT logs',
        to: '/attendance/missing-biometrics',
      })
    }
    return tiles
  }, [visibleStats, hasPermission, bioLoading, bioGapsByDept.length, missingBioCount, bioAgentOffline])

  const filteredOverviewStats = useMemo(() => {
    const q = overviewQuery.toLowerCase().trim()
    if (!q) return overviewStats
    return overviewStats.filter(
      (s) => s.label.toLowerCase().includes(q) || s.hint.toLowerCase().includes(q)
    )
  }, [overviewStats, overviewQuery])

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">
            Hello, {appUser?.full_name?.split(' ')[0] || 'there'}
          </h2>
          <p className="text-sm text-muted-foreground">{permissions.size} permissions</p>
        </div>
        <div className="text-right text-sm">
          <div className="font-medium">
            {new Date().toLocaleDateString(undefined, {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </div>
          <div className="text-xs text-muted-foreground">
            {new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search overview… (e.g. overtime, leave, attendance)"
          className="pl-9"
          value={overviewQuery}
          onChange={(e) => setOverviewQuery(e.target.value)}
        />
      </div>

      {/* Overview — stat tiles (matches dashboard screenshot) */}
      <section aria-label="Overview">
        <h3 className="sr-only">Overview</h3>
        {filteredOverviewStats.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6">No overview cards match your search.</p>
        ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {filteredOverviewStats.map((s) => {
          const interactive = !!(s.to || s.onClick)
          const card = (
            <Card className={cn('transition-colors', interactive && 'cursor-pointer hover:border-primary/40 hover:bg-accent/40')}>
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">{s.label}</CardTitle>
                <s.icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-semibold tabular-nums">{s.value}</div>
                <p className="text-xs text-muted-foreground pt-1">{s.hint}</p>
              </CardContent>
            </Card>
          )
          if (s.onClick) {
            return (
              <button key={s.label} type="button" className="block w-full text-left" onClick={s.onClick}>
                {card}
              </button>
            )
          }
          if (s.to?.startsWith('#')) {
            return (
              <a key={s.label} href={s.to} className="block">
                {card}
              </a>
            )
          }
          return s.to ? (
            <Link key={s.label} to={s.to}>
              {card}
            </Link>
          ) : (
            <div key={s.label}>{card}</div>
          )
        })}
        </div>
        )}
      </section>

      {/* Live attendance feed — directly under stats (matches screenshot) */}
      {hasPermission('attendance.view') && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" /> Live punches today
              </CardTitle>
              <CardDescription>Updates automatically when devices or manual punches record attendance.</CardDescription>
            </div>
            <Link to="/attendance" className="text-xs text-primary hover:underline">
              Open attendance →
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {livePunches.length === 0 ? (
              <div className="px-6 py-8 text-sm text-muted-foreground">No punches recorded yet today.</div>
            ) : (
              <div className="divide-y">
                {livePunches.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-3 px-6 py-3 text-sm">
                    <div className="min-w-0">
                      <div className="font-semibold truncate uppercase tracking-wide">{p.name}</div>
                      <div className="text-xs text-muted-foreground font-mono">{p.code}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-semibold tabular-nums">
                        {new Date(p.punch_at).toLocaleTimeString(undefined, {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {p.source.replace('_', ' ')}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Missing fingerprint / face on device — grouped by department */}
      {hasPermission('employee.view') && hasPermission('attendance.view') && (
        <Card id="bio-gaps">
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Fingerprint className="h-4 w-4 text-primary" />
                Biometric enrollment gaps by department
              </CardTitle>
              <CardDescription>
                Active employees with a device PIN who are missing fingerprint and/or face on their ZKTeco
                machine. Each person is listed once.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 print:hidden"
              disabled={bioLoading}
              onClick={() => void loadBiometricGaps()}
            >
              <RefreshCw className={cn('h-4 w-4 mr-1', bioLoading && 'animate-spin')} />
              Refresh
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {bioLoading && bioGapsByDept.length === 0 ? (
              <p className="text-sm text-muted-foreground">Scanning devices via agent…</p>
            ) : bioAgentOffline ? (
              <p className="text-sm text-muted-foreground">
                ZKT agent is not reachable. Run the agent on the office PC (with ZKTime installed), then click
                Refresh.
              </p>
            ) : bioGapsByDept.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No missing fingerprint or face enrollments found for mapped employees.
                {bioScannedAt && (
                  <span className="block text-xs mt-1">
                    Last scan: {new Date(bioScannedAt).toLocaleString()}
                  </span>
                )}
              </p>
            ) : (
              <>
                {bioScannedAt && (
                  <p className="text-xs text-muted-foreground">
                    Last scan: {new Date(bioScannedAt).toLocaleString()}
                  </p>
                )}
                <div className="space-y-5">
                  {bioGapsByDept.map((dept) => (
                    <div key={dept.department}>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <h4 className="text-sm font-semibold">{dept.department}</h4>
                        <span className="text-xs text-muted-foreground tabular-nums">{dept.rows.length}</span>
                      </div>
                      <ul className="divide-y rounded-lg border text-sm">
                        {dept.rows.map((row) => (
                          <li key={row.employeeId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                            <div className="min-w-0">
                              <Link to={`/employees/${row.employeeId}`} className="font-medium hover:text-primary">
                                {row.name}
                              </Link>
                              <div className="text-xs text-muted-foreground font-mono">{row.code}</div>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {row.missingFinger && (
                                <Badge variant="outline" className="gap-1 text-amber-700 border-amber-300 dark:text-amber-300">
                                  <Fingerprint className="h-3 w-3" />
                                  Finger missing
                                </Badge>
                              )}
                              {row.missingFace && (
                                <Badge variant="outline" className="gap-1 text-rose-700 border-rose-300 dark:text-rose-300">
                                  <ScanFace className="h-3 w-3" />
                                  Face missing
                                </Badge>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Announcements feed */}
      {hasPermission('announcement.view') && announcements.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Megaphone className="h-4 w-4 text-primary" /> Announcements
              </CardTitle>
              <CardDescription>Latest company-wide updates.</CardDescription>
            </div>
            <Link to="/announcements" className="text-xs text-primary hover:underline">
              View all →
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {announcements.map((a) => (
                <Link
                  key={a.id}
                  to={`/announcements/${a.id}`}
                  className={cn(
                    'flex items-center gap-3 px-6 py-3 hover:bg-muted/30',
                    a.pinned && 'bg-amber-50/40 dark:bg-amber-950/10'
                  )}
                >
                  <div className="flex flex-col items-center gap-0.5 min-w-[20px]">
                    {a.pinned && <Pin className="h-3.5 w-3.5 text-amber-600" />}
                    {a.priority === 'URGENT' && <AlertTriangle className="h-3.5 w-3.5 text-red-600" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                        {a.category}
                      </span>
                      {a.unread && <span className="inline-flex h-1.5 w-1.5 rounded-full bg-primary" />}
                    </div>
                    <div className={cn('truncate text-sm', a.unread ? 'font-semibold' : 'font-medium')}>
                      {a.title}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {a.published_at ? new Date(a.published_at).toLocaleDateString() : '—'}
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Today snapshot + system overview */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-primary" /> On leave today
            </CardTitle>
            <CardDescription>Approved leave currently in effect.</CardDescription>
          </CardHeader>
          <CardContent>
            {onLeaveList.length === 0 ? (
              <div className="text-sm text-muted-foreground">No employees on leave today.</div>
            ) : (
              <ul className="space-y-2 text-sm">
                {onLeaveList.map((l) => (
                  <li key={l.id} className="flex items-center justify-between">
                    <div>
                      <div className="font-medium">{l.name}</div>
                      <div className="text-xs text-muted-foreground">{l.type}</div>
                    </div>
                    <div className="text-xs text-muted-foreground">until {l.until}</div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarRange className="h-4 w-4 text-primary" /> Upcoming holidays
            </CardTitle>
            <CardDescription>Next 30 days.</CardDescription>
          </CardHeader>
          <CardContent>
            {upcomingHolidays.length === 0 ? (
              <div className="text-sm text-muted-foreground">No holidays in the next 30 days.</div>
            ) : (
              <ul className="space-y-2 text-sm">
                {upcomingHolidays.map((h) => (
                  <li key={h.id} className="flex items-center justify-between">
                    <span className="font-medium">{h.name}</span>
                    <span className="text-xs text-muted-foreground">{h.date}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" /> System overview
            </CardTitle>
            <CardDescription>What's running right now.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Active devices</span>
              <span className="font-medium tabular-nums">{stats.activeDevices}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">System users</span>
              <span className="font-medium tabular-nums">{stats.users}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Your roles</span>
              <span className="font-medium">{roles.join(', ') || '—'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Your permissions</span>
              <span className="font-medium tabular-nums">{permissions.size}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
