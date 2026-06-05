import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Printer, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { fmtPKR, defaultEmployeeStatutory, lineAllowedByStatutory, loadEmployeeStatutoryForPeriod, loadEmployeeCompAllowancesForPeriod, lineAllowedByCompensation, type EmployeeStatutory, type CompensationAllowances } from '@/lib/payroll'
import { toast } from 'sonner'

type Payslip = {
  id: string
  employee_id: string
  employee_code: string
  employee_name: string
  designation: string | null
  department: string | null
  branch: string | null
  days_in_period: number
  working_days: number
  present_days: number
  paid_leave_days: number
  unpaid_leave_days: number
  absent_days: number
  holidays_count: number
  basic: number
  gross_earnings: number
  total_deductions: number
  employer_contrib: number
  tax_amount: number
  eobi_employee: number
  eobi_employer: number
  pf_employee: number
  pf_employer: number
  net_pay: number
  status: string
  payroll_periods?: { name: string; period_start: string; period_end: string; pay_date: string | null; code: string }
}

type Line = {
  id: string
  component_code: string
  component_name: string
  component_type: 'EARNING' | 'DEDUCTION' | 'EMPLOYER_CONTRIB'
  amount: number
  base_amount: number | null
  formula_used: string | null
  sort_order: number
}

export function PayslipDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [slip, setSlip] = useState<Payslip | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [statutory, setStatutory] = useState<EmployeeStatutory>(defaultEmployeeStatutory())
  const [compAllowances, setCompAllowances] = useState<CompensationAllowances | null>(null)
  const [company, setCompany] = useState<{ name: string; legal_name: string | null; address: string | null } | null>(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    if (!id) return
    setLoading(true)
    const [ps, ln, co] = await Promise.all([
      supabase
        .from('payslips')
        .select('*, payroll_periods(name, period_start, period_end, pay_date, code)')
        .eq('id', id)
        .single(),
      supabase
        .from('payslip_lines')
        .select('*')
        .eq('payslip_id', id)
        .order('sort_order'),
      supabase.from('companies').select('name, legal_name, address').limit(1).maybeSingle(),
    ])
    if (ps.error || !ps.data) {
      toast.error('Payslip not found', { description: ps.error?.message })
    } else {
      const row = ps.data as Payslip
      setSlip(row)
      const periodEnd = row.payroll_periods?.period_end
      const periodStart = row.payroll_periods?.period_start
      if (row.employee_id && periodEnd && periodStart) {
        const [stat, allowances] = await Promise.all([
          loadEmployeeStatutoryForPeriod(row.employee_id, periodEnd),
          loadEmployeeCompAllowancesForPeriod(row.employee_id, periodStart, periodEnd),
        ])
        setStatutory(stat)
        setCompAllowances(allowances)
      } else {
        setStatutory(defaultEmployeeStatutory())
        setCompAllowances(null)
      }
    }
    setLines((ln.data ?? []) as Line[])
    if (co.data) setCompany(co.data as { name: string; legal_name: string | null; address: string | null })
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [id])

  if (loading) {
    return (
      <div className="p-12 grid place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (!slip) return null

  const earnings = lines.filter(
    (l) =>
      l.component_type === 'EARNING' &&
      (!compAllowances || lineAllowedByCompensation(l.component_code, compAllowances))
  )
  const deductions = lines.filter(
    (l) => l.component_type === 'DEDUCTION' && lineAllowedByStatutory(l.component_code, l.component_type, statutory)
  )
  const employer = lines.filter(
    (l) =>
      l.component_type === 'EMPLOYER_CONTRIB' && lineAllowedByStatutory(l.component_code, l.component_type, statutory)
  )
  const grossEarnings = earnings.reduce((s, l) => s + Number(l.amount), 0)
  const totalDeductions = deductions.reduce((s, l) => s + Number(l.amount), 0)
  const displayNetPay = Math.round((grossEarnings - totalDeductions) * 100) / 100
  const showDeductions = deductions.length > 0
  const showNetPay = showDeductions
  const showLineWarning =
    earnings.length === 0 && (Number(slip.basic) > 0 || Number(slip.gross_earnings) > 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between print:hidden">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Print / Save PDF
          </Button>
        </div>
      </div>

      <Card className="print:shadow-none print:border-0">
        <CardHeader className="border-b">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="text-2xl">{company?.name || 'Company'}</CardTitle>
              {company?.legal_name && <CardDescription>{company.legal_name}</CardDescription>}
              {company?.address && <p className="text-xs text-muted-foreground mt-1">{company.address}</p>}
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Payslip</div>
              <div className="font-mono text-sm">{slip.payroll_periods?.code}</div>
              <Badge variant={slip.status === 'PAID' ? 'success' : slip.status === 'FINAL' ? 'warm' : 'outline'} className="mt-1">
                {slip.status}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6 pt-6">
          {/* Employee + period info */}
          <div className="grid sm:grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Employee</div>
              <div className="font-medium">{slip.employee_name}</div>
              <div className="text-muted-foreground font-mono text-xs">{slip.employee_code}</div>
              <div className="text-muted-foreground">
                {slip.designation || '—'}
                {slip.department ? ` · ${slip.department}` : ''}
              </div>
              {slip.branch && <div className="text-muted-foreground">{slip.branch}</div>}
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Period</div>
              <div className="font-medium">{slip.payroll_periods?.name}</div>
              <div className="text-muted-foreground">
                {slip.payroll_periods?.period_start} → {slip.payroll_periods?.period_end}
              </div>
              {slip.payroll_periods?.pay_date && (
                <div className="text-muted-foreground">Pay date: {slip.payroll_periods.pay_date}</div>
              )}
            </div>
          </div>

          {/* Attendance summary */}
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-xs border rounded-lg p-3 bg-muted/20">
            <div>
              <div className="text-muted-foreground">Days in period</div>
              <div className="font-medium tabular-nums">{slip.days_in_period}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Working days</div>
              <div className="font-medium tabular-nums">{slip.working_days}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Present</div>
              <div className="font-medium tabular-nums">{slip.present_days}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Paid leave</div>
              <div className="font-medium tabular-nums">{slip.paid_leave_days}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Unpaid leave</div>
              <div className="font-medium tabular-nums">{slip.unpaid_leave_days}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Holidays</div>
              <div className="font-medium tabular-nums">{slip.holidays_count}</div>
            </div>
          </div>

          {/* Earnings & Deductions side-by-side */}
          {showLineWarning && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-100">
              This payslip has no line breakdown. Go to the payroll period, enable{' '}
              <strong>Replace already posted payslips</strong>, and post again to recalculate earnings and
              deductions.
            </div>
          )}
          <div className={`grid gap-6 ${showDeductions ? 'sm:grid-cols-2' : 'sm:grid-cols-1'}`}>
            <div>
              <div className="text-sm font-semibold mb-2 pb-1 border-b">Earnings</div>
              <table className="w-full text-sm">
                <tbody className="divide-y">
                  {earnings.map((l) => (
                    <tr key={l.id}>
                      <td className="py-1.5">
                        <div>{l.component_name}</div>
                        {l.formula_used && (
                          <div className="text-xs text-muted-foreground">{l.formula_used}</div>
                        )}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{fmtPKR(Number(l.amount))}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold border-t-2">
                    <td className="py-2">{showNetPay ? 'Gross earnings' : 'Amount payable'}</td>
                    <td className="py-2 text-right tabular-nums">{fmtPKR(grossEarnings)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {showDeductions && (
              <div>
                <div className="text-sm font-semibold mb-2 pb-1 border-b">Deductions</div>
                <table className="w-full text-sm">
                  <tbody className="divide-y">
                    {deductions.map((l) => (
                      <tr key={l.id}>
                        <td className="py-1.5">
                          <div>{l.component_name}</div>
                          {l.formula_used && (
                            <div className="text-xs text-muted-foreground">{l.formula_used}</div>
                          )}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">{fmtPKR(Number(l.amount))}</td>
                      </tr>
                    ))}
                    <tr className="font-semibold border-t-2">
                      <td className="py-2">Total deductions</td>
                      <td className="py-2 text-right tabular-nums">{fmtPKR(totalDeductions)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {showNetPay && (
            <div className="rounded-lg border-2 border-primary/30 bg-primary/5 p-4 flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Net pay</div>
                <div className="text-3xl font-bold tabular-nums text-primary">{fmtPKR(displayNetPay)}</div>
              </div>
              <div className="text-xs text-right text-muted-foreground">
                In words:
                <div className="max-w-xs text-foreground font-medium">{numberInWordsPKR(displayNetPay)}</div>
              </div>
            </div>
          )}

          {/* Employer contributions (info) */}
          {employer.length > 0 && (
            <div>
              <div className="text-sm font-semibold mb-2 pb-1 border-b">Employer contributions (informational)</div>
              <table className="w-full text-sm">
                <tbody className="divide-y">
                  {employer.map((l) => (
                    <tr key={l.id}>
                      <td className="py-1.5">{l.component_name}</td>
                      <td className="py-1.5 text-right tabular-nums">{fmtPKR(Number(l.amount))}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold border-t-2">
                    <td className="py-2">Total employer cost</td>
                    <td className="py-2 text-right tabular-nums">{fmtPKR(Number(slip.gross_earnings) + Number(slip.employer_contrib))}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          <div className="text-xs text-muted-foreground border-t pt-4">
            This is a system-generated payslip; no signature is required.
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Number → PKR words (simple, rounded to nearest rupee)
// ---------------------------------------------------------------------------
const ones = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
function chunkWords(n: number): string {
  if (n < 20) return ones[n]
  if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? '-' + ones[n % 10] : '')
  return ones[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' ' + chunkWords(n % 100) : '')
}
function numberInWordsPKR(amount: number): string {
  const n = Math.floor(Math.abs(amount))
  if (n === 0) return 'Zero rupees only'
  const crore = Math.floor(n / 10000000)
  const lakh = Math.floor((n % 10000000) / 100000)
  const thousand = Math.floor((n % 100000) / 1000)
  const rest = n % 1000
  const parts: string[] = []
  if (crore) parts.push(chunkWords(crore) + ' crore')
  if (lakh) parts.push(chunkWords(lakh) + ' lakh')
  if (thousand) parts.push(chunkWords(thousand) + ' thousand')
  if (rest) parts.push(chunkWords(rest))
  return parts.join(' ').replace(/\s+/g, ' ').trim().replace(/^./, (c) => c.toUpperCase()) + ' rupees only'
}
