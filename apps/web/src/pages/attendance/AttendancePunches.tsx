import { useEffect, useMemo, useState } from 'react'
import { Loader2, RefreshCw, Search } from 'lucide-react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { PageHeader } from '@/components/master/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { nextDateIso } from '@/lib/attendance'

type PunchRow = {
  id: string
  punch_at: string
  punch_type: string
  source: string
  employees: { full_name: string; employee_code: string } | null
  attendance_devices: { name: string; serial_no: string | null } | null
}

export function AttendancePunchesPage() {
  const [rows, setRows] = useState<PunchRow[]>([])
  const [loading, setLoading] = useState(true)
  const [date, setDate] = useState(() => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }))
  const [query, setQuery] = useState('')

  async function load() {
    setLoading(true)
    let q = supabase
      .from('attendance_punches')
      .select(
        'id, punch_at, punch_type, source, employees(full_name, employee_code), attendance_devices(name, serial_no)',
      )
      .gte('punch_at', `${date}T00:00:00+05:00`)
      .lt('punch_at', `${nextDateIso(date)}T00:00:00+05:00`)
      .order('punch_at', { ascending: true })

    const { data, error } = await q
    if (!error) {
      setRows(
        (data ?? []).map((r) => {
          const row = r as Record<string, unknown>
          const emp = row.employees
          const dev = row.attendance_devices
          return {
            id: row.id as string,
            punch_at: row.punch_at as string,
            punch_type: row.punch_type as string,
            source: row.source as string,
            employees: Array.isArray(emp) ? (emp[0] as PunchRow['employees']) : (emp as PunchRow['employees']),
            attendance_devices: Array.isArray(dev)
              ? (dev[0] as PunchRow['attendance_devices'])
              : (dev as PunchRow['attendance_devices']),
          }
        }),
      )
    }
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [date])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => {
      const name = r.employees?.full_name?.toLowerCase() ?? ''
      const code = r.employees?.employee_code?.toLowerCase() ?? ''
      const device = r.attendance_devices?.name?.toLowerCase() ?? ''
      const source = r.source.toLowerCase()
      return name.includes(q) || code.includes(q) || device.includes(q) || source.includes(q)
    })
  }, [rows, query])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance punches"
        description="Raw punch log from devices and manual entry — newest rows at the bottom."
        actions={
          <>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" />
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/attendance">Daily register →</Link>
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <CardTitle className="text-base">Punch log</CardTitle>
              <CardDescription>{filtered.length} punch(es) for {date}</CardDescription>
            </div>
            <div className="relative flex-1 min-w-[200px] max-w-sm ml-auto">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search employee, device, source…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-16 grid place-items-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-16 text-center text-sm text-muted-foreground">No punches recorded for this date.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
                  <tr className="text-left">
                    <th className="px-4 py-3 w-12">#</th>
                    <th className="px-3 py-3">Employee</th>
                    <th className="px-3 py-3">Time</th>
                    <th className="px-3 py-3">Type</th>
                    <th className="px-3 py-3">Source</th>
                    <th className="px-3 py-3">Device</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map((r, i) => (
                    <tr key={r.id} className="hover:bg-muted/20">
                      <td className="px-4 py-3 tabular-nums text-muted-foreground">{i + 1}</td>
                      <td className="px-3 py-3">
                        <div className="font-medium">{r.employees?.full_name ?? '—'}</div>
                        <div className="text-xs text-muted-foreground font-mono">{r.employees?.employee_code ?? '—'}</div>
                      </td>
                      <td className="px-3 py-3 tabular-nums whitespace-nowrap">
                        {new Date(r.punch_at).toLocaleString('en-PK', {
                          dateStyle: 'short',
                          timeStyle: 'medium',
                        })}
                      </td>
                      <td className="px-3 py-3 capitalize">{r.punch_type}</td>
                      <td className="px-3 py-3">
                        <Badge variant="outline">{r.source.replace('_', ' ')}</Badge>
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {r.attendance_devices?.name ?? '—'}
                        {r.attendance_devices?.serial_no && (
                          <span className="block text-[10px] font-mono">{r.attendance_devices.serial_no}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
