import { useEffect, useMemo, useState } from 'react'
import { Activity, ChevronDown, Loader2, MapPin, RefreshCw, Search } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { PageHeader } from '@/components/master/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { avatarColorFor, cn, initialsFromName } from '@/lib/utils'
import {
  classifyLiveAttendance,
  countLiveAttendance,
  getLiveDisplayStatus,
  liveBucketLabels,
  liveDisplayStatusClass,
  type LiveAttendanceBucket,
  type LiveAttendanceDaily,
} from '@/lib/liveAttendance'
import {
  nextDateIso,
  punchOnDate,
  resolveInOutFromPunches,
  todayInCompanyTz,
} from '@/lib/attendance'

type Employee = {
  id: string
  employee_code: string
  full_name: string
  photo_url: string | null
  branch_id?: string | null
  branches: { name: string } | null
}

type BucketFilter = LiveAttendanceBucket | 'all'

const bucketDotClass: Record<BucketFilter, string> = {
  all: 'bg-slate-400',
  in: 'bg-teal-500',
  out: 'bg-blue-500',
  break: 'bg-amber-400',
  leave: 'bg-violet-500',
  absent: 'bg-red-500',
}

const fmtTime = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', hour12: true })
    : null

const BRANCH_SORT_ORDER = ['office', 'godown 1', 'godown  1', 'emb godown']

const getBranchOrderIndex = (name: string) => {
  const normalized = name.toLowerCase().trim()
  const idx = BRANCH_SORT_ORDER.indexOf(normalized)
  return idx === -1 ? 999 : idx
}

export function LiveAttendancePage() {
  const navigate = useNavigate()
  const todayIso = useMemo(() => todayInCompanyTz(), [])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([])
  const [selectedBranchId, setSelectedBranchId] = useState<string>('all')
  const [dailyByEmployee, setDailyByEmployee] = useState<Map<string, LiveAttendanceDaily>>(new Map())
  const [loading, setLoading] = useState(true)
  const [syncedAt, setSyncedAt] = useState<Date | null>(null)
  const [query, setQuery] = useState('')
  const [bucketFilter, setBucketFilter] = useState<BucketFilter>('all')
  const [collapsedBranches, setCollapsedBranches] = useState<Record<string, boolean>>({})

  const toggleBranchCollapse = (branchName: string) => {
    setCollapsedBranches((prev) => ({
      ...prev,
      [branchName]: !prev[branchName],
    }))
  }

  async function load() {
    setLoading(true)
    const [{ data: emps }, { data: daily }, { data: punches }, { data: branchRows }] = await Promise.all([
      supabase
        .from('employees')
        .select('id, employee_code, full_name, photo_url, branch_id, branches(name)')
        .eq('is_active', true)
        .order('employee_code'),
      supabase
        .from('attendance_daily')
        .select('employee_id, attendance_date, status, first_in, last_out, is_holiday, is_weekly_off')
        .eq('attendance_date', todayIso),
      supabase
        .from('attendance_punches')
        .select('employee_id, punch_at, punch_type')
        .gte('punch_at', `${todayIso}T00:00:00+05:00`)
        .lt('punch_at', `${nextDateIso(todayIso)}T00:00:00+05:00`),
      supabase
        .from('branches')
        .select('id, name')
        .eq('is_active', true)
        .order('name'),
    ])

    setEmployees(
      (emps ?? []).map((r: Record<string, unknown>) => {
        const b = r.branches
        return {
          id: r.id as string,
          employee_code: r.employee_code as string,
          full_name: r.full_name as string,
          photo_url: (r.photo_url as string | null) ?? null,
          branch_id: r.branch_id as string | null,
          branches: Array.isArray(b) ? (b[0] as { name: string }) : (b as { name: string } | null),
        }
      })
    )

    setBranches((branchRows ?? []) as { id: string; name: string }[])

    const map = new Map<string, LiveAttendanceDaily>()
    for (const row of daily ?? []) {
      map.set(row.employee_id as string, row as LiveAttendanceDaily)
    }

    const punchesByEmp = new Map<string, { punch_at: string; punch_type: string }[]>()
    for (const p of punches ?? []) {
      const row = p as { employee_id: string; punch_at: string; punch_type: string }
      if (!punchOnDate(row.punch_at, todayIso)) continue
      const list = punchesByEmp.get(row.employee_id) ?? []
      list.push({ punch_at: row.punch_at, punch_type: row.punch_type })
      punchesByEmp.set(row.employee_id, list)
    }
    for (const [employeeId, dayPunches] of punchesByEmp) {
      const resolved = resolveInOutFromPunches(dayPunches)
      const existing = map.get(employeeId)
      map.set(employeeId, {
        ...(existing ?? { status: 'Absent', is_holiday: false, is_weekly_off: false }),
        first_in: resolved.first_in ?? existing?.first_in ?? null,
        last_out: resolved.last_out ?? existing?.last_out ?? null,
        attendance_date: todayIso,
      })
    }

    setDailyByEmployee(map)
    setSyncedAt(new Date())
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [todayIso])

  useEffect(() => {
    const channel = supabase
      .channel('live-attendance-board')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'attendance_daily', filter: `attendance_date=eq.${todayIso}` },
        () => {
          void load()
        }
      )
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'attendance_punches' }, () => {
        void load()
      })
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [todayIso])

  const branchFilteredEmployees = useMemo(() => {
    const list = employees.filter((e) => {
      if (selectedBranchId === 'all') return true
      if (selectedBranchId === 'none') return !e.branch_id
      return e.branch_id === selectedBranchId
    })
    return [...list].sort((a, b) =>
      (a.employee_code || '').localeCompare(b.employee_code || '', undefined, { numeric: true, sensitivity: 'base' })
    )
  }, [employees, selectedBranchId])

  const counts = useMemo(
    () => countLiveAttendance(
      branchFilteredEmployees.map((e) => e.id),
      dailyByEmployee
    ),
    [branchFilteredEmployees, dailyByEmployee]
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return branchFilteredEmployees.filter((e) => {
      const bucket = classifyLiveAttendance(dailyByEmployee.get(e.id))
      if (bucketFilter !== 'all' && bucket !== bucketFilter) return false
      if (!q) return true
      return (
        e.full_name.toLowerCase().includes(q) ||
        e.employee_code.toLowerCase().includes(q) ||
        (e.branches?.name ?? '').toLowerCase().includes(q)
      )
    })
  }, [branchFilteredEmployees, dailyByEmployee, bucketFilter, query])

  const groupedByBranch = useMemo(() => {
    const groups: Record<string, typeof filtered> = {}
    for (const e of filtered) {
      const branchName = e.branches?.name || 'No Branch'
      if (!groups[branchName]) {
        groups[branchName] = []
      }
      groups[branchName].push(e)
    }
    const sortedBranchNames = Object.keys(groups).sort((a, b) => {
      if (a === 'No Branch') return 1
      if (b === 'No Branch') return -1
      
      const idxA = getBranchOrderIndex(a)
      const idxB = getBranchOrderIndex(b)
      
      if (idxA !== idxB) {
        return idxA - idxB
      }
      return a.localeCompare(b)
    })
    return sortedBranchNames.map((name) => ({
      name,
      employees: groups[name],
    }))
  }, [filtered])

  const footerBuckets: BucketFilter[] = ['all', 'in', 'out', 'break', 'leave', 'absent']

  return (
    <div className="flex flex-col min-h-[calc(100vh-8rem)] pb-20">
      <PageHeader
        title="Live attendance"
        description="Who is in, out, on leave, or absent today — updates when punches sync."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/attendance">Daily register →</Link>
            </Button>
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="relative flex-grow sm:flex-grow-0 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search employee"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="w-full sm:w-48">
          <Select
            value={selectedBranchId}
            onChange={(e) => setSelectedBranchId(e.target.value)}
          >
            <option value="all">All Branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
            <option value="none">No Branch</option>
          </Select>
        </div>

        <div className="text-sm text-muted-foreground ml-auto flex flex-wrap items-center gap-3">
          <span>
            Showing {filtered.length} of {branchFilteredEmployees.length}
          </span>
          {syncedAt && (
            <span className="flex items-center gap-1">
              <Activity className="h-3.5 w-3.5" />
              Sync {syncedAt.toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })}
            </span>
          )}
        </div>
      </div>

      {loading && employees.length === 0 ? (
        <div className="flex-1 grid place-items-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex-1 grid place-items-center py-24 text-sm text-muted-foreground">
          No employees match this filter.
        </div>
      ) : (
        <div className="space-y-8">
          {groupedByBranch.map((group) => {
            const isCollapsed = !!collapsedBranches[group.name]
            return (
              <div key={group.name} className="space-y-4">
                <button
                  type="button"
                  onClick={() => toggleBranchCollapse(group.name)}
                  className="flex items-center gap-2 border-b pb-2 w-full text-left hover:text-primary transition-colors group font-semibold text-sm text-foreground uppercase tracking-wider"
                >
                  <MapPin className="h-4 w-4 text-orange-500 shrink-0 group-hover:scale-110 transition-transform" />
                  <span className="flex-grow">{group.name}</span>
                  <Badge variant="secondary" className="text-xs font-mono font-semibold mr-1">
                    {group.employees.length}
                  </Badge>
                  <ChevronDown
                    className={cn(
                      'h-4 w-4 text-muted-foreground transition-transform duration-200',
                      isCollapsed && '-rotate-90'
                    )}
                  />
                </button>
                {!isCollapsed && (
                  <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(11.5rem,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(12.5rem,1fr))]">
                    {group.employees.map((e) => {
                      const d = dailyByEmployee.get(e.id)
                      const displayStatus = getLiveDisplayStatus(d)
                      const timeLabel = fmtTime(d?.first_in)
                      return (
                        <button
                          key={e.id}
                          type="button"
                          onClick={() => navigate(`/attendance/live/${e.id}`)}
                          className="rounded-xl border bg-card p-4 flex flex-col items-center text-center gap-2.5 hover:border-primary/40 hover:shadow-sm transition-all min-h-[11rem]"
                        >
                          <Avatar className={cn('h-14 w-14 text-base font-semibold shrink-0', avatarColorFor(e.full_name))}>
                            {e.photo_url && <AvatarImage src={e.photo_url} alt={e.full_name} />}
                            <AvatarFallback className="bg-transparent text-inherit">
                              {initialsFromName(e.full_name)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="w-full space-y-1">
                            <div className="text-[11px] font-mono text-muted-foreground leading-none">{e.employee_code}</div>
                            <div className="text-sm font-semibold leading-snug break-words hyphens-auto">
                              {e.full_name}
                            </div>
                            <div className="flex items-start justify-center gap-1 text-[11px] text-muted-foreground pt-0.5 text-center">
                              <MapPin className="h-3 w-3 shrink-0 mt-0.5" />
                              <span className="break-words leading-snug">{e.branches?.name ?? 'No branch'}</span>
                            </div>
                          </div>
                          <span
                            className={cn(
                              'text-[10px] uppercase tracking-wide font-semibold px-2.5 py-1 rounded',
                              liveDisplayStatusClass[displayStatus]
                            )}
                          >
                            {displayStatus}
                          </span>
                          {timeLabel && (
                            <span className="text-xs font-semibold tabular-nums text-muted-foreground">
                              In {timeLabel}
                              {d?.last_out ? ` · Out ${fmtTime(d.last_out)}` : ''}
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="fixed bottom-0 left-0 right-0 z-30 border-t bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 lg:left-64">
        <div className="max-w-[100vw] overflow-x-auto px-4 py-3 flex items-center justify-center gap-6 sm:gap-10 text-sm">
          {footerBuckets.map((key) => {
            const n = key === 'all' ? counts.all : counts[key]
            const active = bucketFilter === key
            return (
              <button
                key={key}
                type="button"
                onClick={() => setBucketFilter(key)}
                className={cn(
                  'flex items-center gap-2 shrink-0 rounded-lg px-2 py-1 transition-colors',
                  active && 'bg-muted font-semibold'
                )}
              >
                <span className={cn('h-2.5 w-2.5 rounded-full', bucketDotClass[key])} />
                <span>{liveBucketLabels[key]}</span>
                <span className="tabular-nums font-semibold">{n}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
