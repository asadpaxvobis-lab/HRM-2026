import { useEffect, useMemo, useState } from 'react'
import { Download, Loader2, Printer, RefreshCw, Search } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { PageHeader } from '@/components/master/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { downloadCsv, toCsv } from '@/lib/csv'
import { FilterBar, ReportBackLink, printableStyles } from './shared'

type Row = {
  id: string
  employee_code: string
  full_name: string
  email: string | null
  phone: string | null
  cnic: string | null
  date_of_joining: string | null
  employment_status: string | null
  is_active: boolean
  branches: { name: string } | null
  departments: { name: string } | null
  designations: { title: string } | null
  salary: {
    basic: number
    house_rent: number
    house_rent_enabled: boolean
    medical: number
    medical_enabled: boolean
    conveyance: number
    conveyance_enabled: boolean
    utilities: number
    utilities_enabled: boolean
    other_allowances: number
    other_allowances_enabled: boolean
    pay_frequency: string
  } | null
}

const fmtMoney = (v: number) =>
  v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function getRowSalaryDetails(r: Row) {
  const basic = r.salary?.basic ?? 0
  const house_rent = r.salary?.house_rent_enabled ? r.salary.house_rent : 0
  const medical = r.salary?.medical_enabled ? r.salary.medical : 0
  const conveyance = r.salary?.conveyance_enabled ? r.salary.conveyance : 0
  const utilities = r.salary?.utilities_enabled ? r.salary.utilities : 0
  const other = r.salary?.other_allowances_enabled ? r.salary.other_allowances : 0
  const gross = basic + house_rent + medical + conveyance + utilities + other
  return { basic, house_rent, medical, conveyance, utilities, other, gross }
}

export function SalaryDirectoryReportPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [branchFilter, setBranchFilter] = useState('')
  const [deptFilter, setDeptFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<'active' | 'all'>('active')

  async function load() {
    setLoading(true)
    let q = supabase
      .from('employees')
      .select(`
        id, employee_code, full_name, email, phone, cnic, date_of_joining, employment_status, is_active,
        branches(name), departments(name), designations(title),
        employee_salary_history(
          basic, house_rent, house_rent_enabled, medical, medical_enabled,
          conveyance, conveyance_enabled, utilities, utilities_enabled,
          other_allowances, other_allowances_enabled, pay_frequency,
          effective_from, effective_to
        )
      `)
      .order('full_name')

    if (statusFilter === 'active') q = q.eq('is_active', true)
    const { data, error } = await q
    if (error) {
      toast.error('Failed to load', { description: error.message })
    } else {
      const mapped = (data ?? []).map((r) => {
        const row = r as Record<string, unknown>
        const pick = (k: string) => {
          const v = row[k]
          return Array.isArray(v) ? (v[0] as object | null) : (v as object | null)
        }

        const histories = (row.employee_salary_history as any[]) ?? []
        const todayStr = new Date().toISOString().slice(0, 10)
        const activeSalary =
          histories.find(
            (s) => s.effective_from <= todayStr && (!s.effective_to || s.effective_to >= todayStr)
          ) ||
          histories[0] ||
          null

        return {
          id: row.id as string,
          employee_code: row.employee_code as string,
          full_name: row.full_name as string,
          email: row.email as string | null,
          phone: row.phone as string | null,
          cnic: row.cnic as string | null,
          date_of_joining: row.date_of_joining as string | null,
          employment_status: row.employment_status as string | null,
          is_active: row.is_active as boolean,
          branches: pick('branches') as { name: string } | null,
          departments: pick('departments') as { name: string } | null,
          designations: pick('designations') as { title: string } | null,
          salary: activeSalary
            ? {
                basic: Number(activeSalary.basic),
                house_rent: Number(activeSalary.house_rent),
                house_rent_enabled: !!activeSalary.house_rent_enabled,
                medical: Number(activeSalary.medical),
                medical_enabled: !!activeSalary.medical_enabled,
                conveyance: Number(activeSalary.conveyance),
                conveyance_enabled: !!activeSalary.conveyance_enabled,
                utilities: Number(activeSalary.utilities),
                utilities_enabled: !!activeSalary.utilities_enabled,
                other_allowances: Number(activeSalary.other_allowances),
                other_allowances_enabled: !!activeSalary.other_allowances_enabled,
                pay_frequency: activeSalary.pay_frequency as string,
              }
            : null,
        } as Row
      })
      setRows(mapped)
    }
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [statusFilter])

  const branches = useMemo(() => {
    const s = new Set(rows.map((r) => r.branches?.name).filter(Boolean) as string[])
    return Array.from(s).sort()
  }, [rows])

  const departments = useMemo(() => {
    const s = new Set(rows.map((r) => r.departments?.name).filter(Boolean) as string[])
    return Array.from(s).sort()
  }, [rows])

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (branchFilter && r.branches?.name !== branchFilter) return false
      if (deptFilter && r.departments?.name !== deptFilter) return false
      if (search.trim()) {
        const s = search.toLowerCase()
        if (
          !r.full_name.toLowerCase().includes(s) &&
          !r.employee_code.toLowerCase().includes(s) &&
          !(r.email ?? '').toLowerCase().includes(s) &&
          !(r.cnic ?? '').toLowerCase().includes(s)
        )
          return false
      }
      return true
    })
  }, [rows, branchFilter, deptFilter, search])

  const totals = useMemo(() => {
    let basic = 0
    let house_rent = 0
    let medical = 0
    let conveyance = 0
    let utilities = 0
    let other = 0
    let gross = 0
    filtered.forEach((r) => {
      const s = getRowSalaryDetails(r)
      basic += s.basic
      house_rent += s.house_rent
      medical += s.medical
      conveyance += s.conveyance
      utilities += s.utilities
      other += s.other
      gross += s.gross
    })
    return { basic, house_rent, medical, conveyance, utilities, other, gross }
  }, [filtered])

  const summary = useMemo(() => {
    return {
      total: filtered.length,
    }
  }, [filtered])

  function exportCsv() {
    const csv = toCsv(
      filtered.map((r) => {
        const s = getRowSalaryDetails(r)
        return {
          employee_code: r.employee_code,
          full_name: r.full_name,
          branch: r.branches?.name ?? '',
          department: r.departments?.name ?? '',
          designation: r.designations?.title ?? '',
          pay_frequency: r.salary?.pay_frequency ?? '—',
          basic: s.basic,
          house_rent_allowance: s.house_rent,
          medical_allowance: s.medical,
          conveyance_allowance: s.conveyance,
          utilities_allowance: s.utilities,
          other_allowance_incentive: s.other,
          gross_monthly: s.gross,
        }
      })
    )
    downloadCsv(`employee-salary-report-${new Date().toISOString().slice(0, 10)}.csv`, csv)
  }

  return (
    <div className="space-y-4">
      <ReportBackLink />
      <PageHeader
        title="Employee with salary"
        description="All employees with their active salary configuration and breakdown of allowances."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="h-4 w-4" /> Print
            </Button>
            <Button size="sm" onClick={exportCsv} disabled={filtered.length === 0}>
              <Download className="h-4 w-4" /> CSV
            </Button>
          </>
        }
      />

      <FilterBar>
        <div className="flex-1 min-w-[180px]">
          <Label className="text-xs">Search</Label>
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Name, code, CNIC, email…"
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="min-w-[160px]">
          <Label className="text-xs">Branch</Label>
          <Select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </Select>
        </div>
        <div className="min-w-[160px]">
          <Label className="text-xs">Department</Label>
          <Select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
        </div>
        <div className="min-w-[140px]">
          <Label className="text-xs">Status</Label>
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'active' | 'all')}>
            <option value="active">Active only</option>
            <option value="all">All</option>
          </Select>
        </div>
      </FilterBar>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-5">
            <div className="text-xs text-muted-foreground">Total employees</div>
            <div className="text-2xl font-semibold">{summary.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="text-xs text-muted-foreground">Total Basic (Monthly)</div>
            <div className="text-2xl font-semibold tabular-nums text-primary">
              PKR {fmtMoney(totals.basic)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="text-xs text-muted-foreground">Total Gross (Monthly)</div>
            <div className="text-2xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
              PKR {fmtMoney(totals.gross)}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {loading ? (
            <div className="p-12 grid place-items-center">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <table className="w-full text-xs report-table min-w-[1000px]">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left px-4 py-3">Code</th>
                  <th className="text-left px-4 py-3">Name</th>
                  <th className="text-left px-4 py-3">Branch</th>
                  <th className="text-left px-4 py-3">Department</th>
                  <th className="text-left px-4 py-3">Pay frequency</th>
                  <th className="text-right px-4 py-3">Basic</th>
                  <th className="text-right px-4 py-3">House rent allowance</th>
                  <th className="text-right px-4 py-3">Medical allowance</th>
                  <th className="text-right px-4 py-3">Conveyance allowance</th>
                  <th className="text-right px-4 py-3">Utilities allowance</th>
                  <th className="text-right px-4 py-3">Other allowances / incentive</th>
                  <th className="text-right px-4 py-3 font-semibold">Gross (Monthly)</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((r) => {
                  const s = getRowSalaryDetails(r)
                  return (
                    <tr key={r.id} className="hover:bg-muted/30">
                      <td className="px-4 py-2 font-mono text-xs">{r.employee_code}</td>
                      <td className="px-4 py-2 font-medium">{r.full_name}</td>
                      <td className="px-4 py-2">{r.branches?.name ?? '—'}</td>
                      <td className="px-4 py-2">{r.departments?.name ?? '—'}</td>
                      <td className="px-4 py-2">{r.salary?.pay_frequency ?? '—'}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtMoney(s.basic)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtMoney(s.house_rent)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtMoney(s.medical)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtMoney(s.conveyance)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtMoney(s.utilities)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtMoney(s.other)}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">
                        {fmtMoney(s.gross)}
                      </td>
                    </tr>
                  )
                })}
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="px-4 py-12 text-center text-muted-foreground">
                      No employees match the current filters.
                    </td>
                  </tr>
                ) : (
                  <tr className="bg-muted/30 font-semibold border-t-2">
                    <td colSpan={5} className="px-4 py-3 text-left">
                      Total
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmtMoney(totals.basic)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmtMoney(totals.house_rent)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmtMoney(totals.medical)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmtMoney(totals.conveyance)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmtMoney(totals.utilities)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmtMoney(totals.other)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">
                      {fmtMoney(totals.gross)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <style>{printableStyles}</style>
    </div>
  )
}
