export type NavItem = {
  label: string
  to: string
  perm?: string
  /** Always visible when the section uses partial collapse */
  pinned?: boolean
}

export type NavSection = {
  heading?: string
  items: NavItem[]
  /** Collapse some or all items until the section heading is clicked */
  collapsible?: boolean
}

export const navSections: NavSection[] = [
  {
    items: [
      { label: 'Dashboard', to: '/' },
      { label: 'Profile', to: '/profile' },
    ],
  },
  {
    heading: 'Masters',
    collapsible: true,
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
    collapsible: true,
    items: [
      { label: 'Live attendance', to: '/attendance/live', perm: 'attendance.view', pinned: true },
      { label: 'Late employees', to: '/attendance/late', perm: 'attendance.view', pinned: true },
      { label: 'Bulk Shift Assign', to: '/roster', perm: 'shift.view' },
      { label: 'Attendance', to: '/attendance', perm: 'attendance.view' },
      { label: 'Attendance punches', to: '/attendance/punches', perm: 'attendance.view' },
      { label: 'Corrections', to: '/attendance/corrections', perm: 'attendance.view' },
      { label: 'Overtime taken', to: '/overtime/taken', perm: 'overtime.view' },
      { label: 'Overtime Approval', to: '/overtime/approval', perm: 'overtime.view' },
      { label: 'OT type & rate', to: '/overtime/edit-type', perm: 'overtime.approve' },
      { label: 'Overtime', to: '/overtime', perm: 'overtime.view' },
      { label: 'Overtime report', to: '/reports/overtime', perm: 'overtime.view' },
    ],
  },
  {
    heading: 'Leave',
    collapsible: true,
    items: [
      { label: 'Leave requests', to: '/leave', perm: 'leave.view' },
      { label: 'Leave balances', to: '/leave/balances', perm: 'leave.view' },
      { label: 'Leave types', to: '/leave/types', perm: 'leave.config' },
    ],
  },
  {
    heading: 'Payroll',
    collapsible: true,
    items: [
      { label: 'Payroll runs', to: '/payroll', perm: 'payroll.view' },
      { label: 'Components', to: '/payroll/components', perm: 'payroll.config' },
      { label: 'Tax slabs', to: '/payroll/tax-slabs', perm: 'payroll.view' },
    ],
  },
  {
    heading: 'Claims & Loans',
    collapsible: true,
    items: [
      { label: 'Expense claims', to: '/expenses', perm: 'expense.view' },
      { label: 'Expense categories', to: '/expenses/categories', perm: 'expense.config' },
      { label: 'Loans & advances', to: '/loans', perm: 'loan.view' },
      { label: 'Loan types', to: '/loans/types', perm: 'loan.approve' },
    ],
  },
  {
    heading: 'Recruitment',
    collapsible: true,
    items: [
      { label: 'Recruitment hub', to: '/recruitment', perm: 'recruitment.view' },
      { label: 'Job postings', to: '/recruitment/jobs', perm: 'recruitment.view' },
      { label: 'Candidate pipeline', to: '/recruitment/pipeline', perm: 'recruitment.view' },
    ],
  },
  {
    heading: 'Communication',
    collapsible: true,
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
    collapsible: true,
    items: [
      { label: 'Users', to: '/admin/users', perm: 'user.view' },
      { label: 'Roles & Permissions', to: '/admin/roles', perm: 'role.view' },
      { label: 'Devices', to: '/admin/devices', perm: 'attendance.view' },
      { label: 'Audit Log', to: '/admin/audit', perm: 'audit.view' },
      { label: 'Settings', to: '/admin/settings', perm: 'settings.view' },
    ],
  },
]

export type QuickAction = {
  label: string
  to: string
  perm?: string
}

export const quickAddActions: QuickAction[] = [
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

export function flatNavItems(hasPermission: (code: string) => boolean) {
  return navSections.flatMap((section) =>
    section.items
      .filter((item) => !item.perm || hasPermission(item.perm))
      .map((item) => ({ ...item, heading: section.heading }))
  )
}
