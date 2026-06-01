import { NavLink, useNavigate } from 'react-router-dom'
import { Plus, LogOut } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

type NavItem = {
  label: string
  to: string
  perm?: string
}

type NavSection = {
  heading?: string
  items: NavItem[]
}

const navSections: NavSection[] = [
  {
    items: [
      { label: 'Dashboard', to: '/' },
      { label: 'Profile', to: '/profile' },
    ],
  },
  {
    heading: 'Masters',
    items: [
      { label: 'Employees', to: '/employees', perm: 'employee.view' },
      { label: 'Departments', to: '/departments', perm: 'department.view' },
      { label: 'Designations', to: '/designations', perm: 'designation.view' },
      { label: 'Branches', to: '/branches', perm: 'branch.view' },
      { label: 'Holidays', to: '/holidays', perm: 'holiday.view' },
      { label: 'Shifts', to: '/shifts', perm: 'shift.view' },
    ],
  },
  {
    heading: 'Time & Attendance',
    items: [
      { label: 'Bulk Shift Assign', to: '/roster', perm: 'shift.view' },
      { label: 'Live attendance', to: '/attendance/live', perm: 'attendance.view' },
      { label: 'Late employees', to: '/attendance/late', perm: 'attendance.view' },
      { label: 'Attendance', to: '/attendance', perm: 'attendance.view' },
      { label: 'Corrections', to: '/attendance/corrections', perm: 'attendance.view' },
      { label: 'Overtime taken', to: '/overtime/taken', perm: 'overtime.view' },
      { label: 'Overtime', to: '/overtime', perm: 'overtime.view' },
    ],
  },
  {
    heading: 'Leave',
    items: [
      { label: 'Leave requests', to: '/leave', perm: 'leave.view' },
      { label: 'Leave balances', to: '/leave/balances', perm: 'leave.view' },
      { label: 'Leave types', to: '/leave/types', perm: 'leave.config' },
    ],
  },
  {
    heading: 'Payroll',
    items: [
      { label: 'Payroll runs', to: '/payroll', perm: 'payroll.view' },
      { label: 'Components', to: '/payroll/components', perm: 'payroll.config' },
      { label: 'Tax slabs', to: '/payroll/tax-slabs', perm: 'payroll.view' },
    ],
  },
  {
    heading: 'Claims & Loans',
    items: [
      { label: 'Expense claims', to: '/expenses', perm: 'expense.view' },
      { label: 'Expense categories', to: '/expenses/categories', perm: 'expense.config' },
      { label: 'Loans & advances', to: '/loans', perm: 'loan.view' },
      { label: 'Loan types', to: '/loans/types', perm: 'loan.approve' },
    ],
  },
  {
    heading: 'Recruitment',
    items: [
      { label: 'Recruitment hub', to: '/recruitment', perm: 'recruitment.view' },
      { label: 'Job postings', to: '/recruitment/jobs', perm: 'recruitment.view' },
      { label: 'Candidate pipeline', to: '/recruitment/pipeline', perm: 'recruitment.view' },
    ],
  },
  {
    heading: 'Communication',
    items: [
      { label: 'Announcements', to: '/announcements', perm: 'announcement.view' },
      { label: 'Letters', to: '/letters', perm: 'letter.view' },
      { label: 'Letter templates', to: '/letters/templates', perm: 'letter.template' },
      { label: 'Resignations', to: '/resignations', perm: 'resignation.view' },
    ],
  },
  {
    heading: 'Reports',
    items: [{ label: 'Reports', to: '/reports', perm: 'report.view' }],
  },
  {
    heading: 'Administration',
    items: [
      { label: 'Users', to: '/admin/users', perm: 'user.view' },
      { label: 'Roles & Permissions', to: '/admin/roles', perm: 'role.view' },
      { label: 'Devices', to: '/admin/devices', perm: 'attendance.view' },
      { label: 'Audit Log', to: '/admin/audit', perm: 'audit.view' },
      { label: 'Settings', to: '/admin/settings', perm: 'settings.view' },
    ],
  },
]

type QuickAction = {
  label: string
  to: string
  perm?: string
}

const quickAddActions: QuickAction[] = [
  { label: 'New employee', to: '/employees', perm: 'employee.create' },
  { label: 'New department', to: '/departments', perm: 'department.create' },
  { label: 'New designation', to: '/designations', perm: 'designation.create' },
  { label: 'New branch', to: '/branches', perm: 'branch.create' },
  { label: 'New holiday', to: '/holidays', perm: 'holiday.create' },
  { label: 'New shift', to: '/shifts', perm: 'shift.create' },
  { label: 'New leave request', to: '/leave', perm: 'leave.apply' },
  { label: 'New overtime request', to: '/overtime', perm: 'overtime.apply' },
  { label: 'New expense claim', to: '/expenses', perm: 'expense.apply' },
  { label: 'New loan request', to: '/loans', perm: 'loan.create' },
  { label: 'New letter', to: '/letters', perm: 'letter.create' },
  { label: 'Submit resignation', to: '/resignations', perm: 'resignation.apply' },
  { label: 'New job posting', to: '/recruitment/jobs', perm: 'recruitment.manage' },
  { label: 'New payroll run', to: '/payroll', perm: 'payroll.run' },
  { label: 'New user', to: '/admin/users', perm: 'user.create' },
]

export function Sidebar() {
  const { hasPermission, appUser, signOut } = useAuth()
  const navigate = useNavigate()

  const availableActions = quickAddActions.filter((a) => !a.perm || hasPermission(a.perm))

  return (
    <aside className="hidden lg:flex flex-col w-64 shrink-0 border-r bg-card h-screen sticky top-0">
      {/* Brand */}
      <NavLink
        to="/"
        end
        className="px-5 pt-5 pb-3 block hover:opacity-80 transition-opacity"
        aria-label="Go to dashboard"
      >
        <h1 className="text-xl font-bold tracking-tight">HRM ERP 2026</h1>
      </NavLink>

      {/* Quick add */}
      {availableActions.length > 0 && (
        <div className="px-4 pb-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="w-full flex items-center justify-center gap-2 rounded-full bg-orange-500 hover:bg-orange-600 text-white font-medium text-sm py-2.5 transition-colors shadow-sm"
                type="button"
              >
                <Plus className="h-4 w-4" /> New
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56 max-h-[60vh] overflow-y-auto">
              <DropdownMenuLabel className="text-xs">Quick create</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {availableActions.map((a) => (
                <DropdownMenuItem key={a.label} onClick={() => navigate(a.to)}>
                  {a.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* Sections */}
      <nav className="flex-1 overflow-y-auto px-4 pb-4">
        {navSections.map((section, sIdx) => {
          const visibleItems = section.items.filter((it) => !it.perm || hasPermission(it.perm))
          if (visibleItems.length === 0) return null
          return (
            <div key={section.heading ?? `s-${sIdx}`} className="mb-3">
              {section.heading && (
                <div className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">
                  {section.heading}
                </div>
              )}
              <div>
                {visibleItems.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    className={({ isActive }) =>
                      cn(
                        'block px-2 py-1.5 text-[13.5px] rounded-md transition-colors',
                        isActive
                          ? 'text-primary font-semibold bg-primary/5'
                          : 'text-foreground/80 hover:text-foreground hover:bg-accent/60'
                      )
                    }
                  >
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </div>
          )
        })}
      </nav>

      {/* Footer: email + logout */}
      <div className="border-t px-5 py-3 text-sm">
        <div className="text-muted-foreground text-[13px] truncate">{appUser?.email}</div>
        <button
          type="button"
          onClick={async () => {
            await signOut()
            navigate('/login')
          }}
          className="mt-1 flex items-center gap-1.5 text-[13.5px] text-foreground/80 hover:text-destructive transition-colors"
        >
          <LogOut className="h-3.5 w-3.5" /> Logout
        </button>
      </div>
    </aside>
  )
}
