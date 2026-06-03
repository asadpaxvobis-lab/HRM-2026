import { Link } from 'react-router-dom'
import {
  Users,
  CalendarDays,
  Wallet,
  Landmark,
  ShieldCheck,
  CalendarOff,
  Banknote,
  Timer,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { PageHeader } from '@/components/master/PageHeader'
import { Card, CardContent } from '@/components/ui/card'

type Report = {
  label: string
  description: string
  to: string
  icon: typeof Users
  perm?: string
  tone: 'blue' | 'green' | 'purple' | 'amber' | 'rose' | 'teal' | 'slate'
}

const toneRing: Record<Report['tone'], string> = {
  blue: 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-300',
  green: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-300',
  purple: 'bg-violet-50 dark:bg-violet-950/40 text-violet-600 dark:text-violet-300',
  amber: 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-300',
  rose: 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300',
  teal: 'bg-teal-50 dark:bg-teal-950/40 text-teal-600 dark:text-teal-300',
  slate: 'bg-slate-100 dark:bg-slate-800/40 text-slate-700 dark:text-slate-300',
}

const reports: Report[] = [
  {
    label: 'Employee directory',
    description: 'Headcount by branch, department, designation — exportable list of active employees.',
    to: '/reports/directory',
    icon: Users,
    perm: 'employee.view',
    tone: 'blue',
  },
  {
    label: 'Monthly attendance',
    description: 'Monthly attendance grid (P / A / L / H / W) per employee per day — filter by one person.',
    to: '/reports/muster',
    icon: CalendarDays,
    perm: 'attendance.view',
    tone: 'green',
  },
  {
    label: 'Salary register',
    description: 'Period-wise table of every payslip — earnings, deductions, net pay.',
    to: '/reports/salary-register',
    icon: Wallet,
    perm: 'payroll.view',
    tone: 'purple',
  },
  {
    label: 'Bank disbursement file',
    description: 'CSV-ready list of net pay per employee for a finalized payroll period.',
    to: '/reports/bank-disbursement',
    icon: Banknote,
    perm: 'payroll.view',
    tone: 'teal',
  },
  {
    label: 'Statutory statement',
    description: 'EOBI, PF, and income-tax totals per employee for a payroll period.',
    to: '/reports/statutory',
    icon: ShieldCheck,
    perm: 'payroll.view',
    tone: 'amber',
  },
  {
    label: 'Leave register',
    description: 'Year-wise leave balance and consumption per employee.',
    to: '/reports/leave',
    icon: CalendarOff,
    perm: 'leave.view',
    tone: 'rose',
  },
  {
    label: 'Loan outstanding',
    description: 'Active loans and outstanding balances across employees.',
    to: '/reports/loans',
    icon: Landmark,
    perm: 'loan.view',
    tone: 'slate',
  },
  {
    label: 'Overtime report',
    description: 'Date-wise and employee-wise overtime hours, amount, type and approver.',
    to: '/reports/overtime',
    icon: Timer,
    perm: 'overtime.view',
    tone: 'amber',
  },
]

export function ReportsHubPage() {
  const { hasPermission } = useAuth()
  const visible = reports.filter((r) => !r.perm || hasPermission(r.perm))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Operational and statutory reports for HR, payroll, attendance, leave and loans."
      />
      {visible.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            You don't have permission to view any reports.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((r) => {
            const Icon = r.icon
            return (
              <Link key={r.to} to={r.to} className="group">
                <Card className="h-full hover:border-primary/40 hover:shadow-sm transition-all">
                  <CardContent className="pt-6 space-y-3">
                    <div className={`h-10 w-10 rounded-lg grid place-items-center ${toneRing[r.tone]}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="font-semibold group-hover:text-primary transition-colors">{r.label}</div>
                      <div className="text-xs text-muted-foreground mt-1 leading-relaxed">{r.description}</div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
