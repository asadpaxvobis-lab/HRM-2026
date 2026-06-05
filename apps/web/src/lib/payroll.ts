import { supabase } from './supabase'

// =============================================================================
// Types
// =============================================================================
export type PayrollComponent = {
  id: string
  code: string
  name: string
  component_type: 'EARNING' | 'DEDUCTION' | 'EMPLOYER_CONTRIB'
  calc_method: 'FIXED' | 'PCT_BASIC' | 'PCT_GROSS' | 'FORMULA'
  calc_value: number
  is_taxable: boolean
  is_eobi_applicable: boolean
  is_pf_applicable: boolean
  is_system: boolean
  is_active: boolean
  sort_order: number
}

export type TaxSlab = {
  fy_label: string
  slab_from: number
  slab_to: number | null
  base_tax: number
  rate_pct: number
  sort_order: number
}

export type PayrollPeriod = {
  id: string
  code: string
  name: string
  frequency: 'MONTHLY' | 'SEMI_MONTHLY' | 'WEEKLY'
  period_start: string
  period_end: string
  pay_date: string | null
  status: 'DRAFT' | 'PROCESSING' | 'FINALIZED' | 'RELEASED' | 'PAID'
}

export type EmployeeForRun = {
  id: string
  employee_code: string
  full_name: string
  date_of_joining: string | null
  branch_id: string | null
  department_id: string | null
  designation_id: string | null
  branches?: { name: string } | null
  departments?: { name: string } | null
  designations?: { title: string } | null
  basic: number
  house_rent: number
  medical: number
  conveyance: number
  utilities: number
  other_allowances: number
  pay_frequency: string
  house_rent_enabled: boolean
  medical_enabled: boolean
  conveyance_enabled: boolean
  utilities_enabled: boolean
  other_allowances_enabled: boolean
}

/** Which optional earnings appear on payslip (from compensation checkboxes). */
export type CompensationAllowances = {
  house_rent_enabled: boolean
  medical_enabled: boolean
  conveyance_enabled: boolean
  utilities_enabled: boolean
  other_allowances_enabled: boolean
}

const ALLOWANCE_LINE_FLAGS: Record<string, keyof CompensationAllowances> = {
  HRA: 'house_rent_enabled',
  MED: 'medical_enabled',
  CONV: 'conveyance_enabled',
  UTIL: 'utilities_enabled',
  OTH: 'other_allowances_enabled',
}

export function parseCompAllowances(sal: Record<string, unknown> | undefined): CompensationAllowances {
  if (!sal) {
    return {
      house_rent_enabled: false,
      medical_enabled: false,
      conveyance_enabled: false,
      utilities_enabled: false,
      other_allowances_enabled: false,
    }
  }
  const hasCol = (k: string) => k in sal
  return {
    house_rent_enabled: hasCol('house_rent_enabled')
      ? sal.house_rent_enabled === true
      : Number(sal.house_rent) > 0,
    medical_enabled: hasCol('medical_enabled') ? sal.medical_enabled === true : Number(sal.medical) > 0,
    conveyance_enabled: hasCol('conveyance_enabled')
      ? sal.conveyance_enabled === true
      : Number(sal.conveyance) > 0,
    utilities_enabled: hasCol('utilities_enabled')
      ? sal.utilities_enabled === true
      : Number(sal.utilities) > 0,
    other_allowances_enabled: hasCol('other_allowances_enabled')
      ? sal.other_allowances_enabled === true
      : Number(sal.other_allowances) > 0,
  }
}

export function lineAllowedByCompensation(componentCode: string, allowances: CompensationAllowances): boolean {
  const flag = ALLOWANCE_LINE_FLAGS[componentCode]
  if (!flag) return true
  return !!allowances[flag]
}

/** Effective compensation flags for payslip display on period end date. */
export async function loadEmployeeCompAllowancesForPeriod(
  employeeId: string,
  periodStart: string,
  periodEnd: string
): Promise<CompensationAllowances> {
  const { data: rows } = await supabase
    .from('employee_salary_history')
    .select('*')
    .eq('employee_id', employeeId)
    .order('effective_from', { ascending: false })
  const pick = pickSalaryForPeriod((rows ?? []) as Array<Record<string, unknown>>, periodStart, periodEnd).get(
    employeeId
  )
  if (!pick) return parseCompAllowances(undefined)
  return parseCompAllowances(pick.row)
}

/** Per-employee statutory enrollment (EOBI / PF / tax toggles on employee profile). */
export type EmployeeStatutory = {
  eobi_enabled: boolean
  eobi_custom_amount: number | null
  pf_enabled: boolean
  pf_employee_pct: number | null
  pf_employer_pct: number | null
  social_security_enabled: boolean
  social_security_custom_amount: number | null
  income_tax_enabled: boolean
}

export function defaultEmployeeStatutory(): EmployeeStatutory {
  return {
    eobi_enabled: false,
    eobi_custom_amount: null,
    pf_enabled: false,
    pf_employee_pct: null,
    pf_employer_pct: null,
    social_security_enabled: false,
    social_security_custom_amount: null,
    income_tax_enabled: false,
  }
}

export function parseStatutoryRow(row: Record<string, unknown> | undefined): EmployeeStatutory {
  if (!row) return defaultEmployeeStatutory()
  return {
    eobi_enabled: !!row.eobi_enabled,
    eobi_custom_amount: row.eobi_custom_amount != null ? Number(row.eobi_custom_amount) : null,
    pf_enabled: !!row.pf_enabled,
    pf_employee_pct: row.pf_employee_pct != null ? Number(row.pf_employee_pct) : null,
    pf_employer_pct: row.pf_employer_pct != null ? Number(row.pf_employer_pct) : null,
    social_security_enabled: !!row.social_security_enabled,
    social_security_custom_amount:
      row.social_security_custom_amount != null ? Number(row.social_security_custom_amount) : null,
    income_tax_enabled: !!row.income_tax_enabled,
  }
}

const STATUTORY_LINE_FLAGS: Record<string, keyof EmployeeStatutory> = {
  EOBI_E: 'eobi_enabled',
  EOBI_R: 'eobi_enabled',
  PF_E: 'pf_enabled',
  PF_R: 'pf_enabled',
  TAX: 'income_tax_enabled',
}

/** Hide EOBI / PF / tax lines on payslip when not enabled on employee statutory tab. */
export function lineAllowedByStatutory(
  componentCode: string,
  componentType: PayrollComponent['component_type'],
  statutory: EmployeeStatutory
): boolean {
  const flag = STATUTORY_LINE_FLAGS[componentCode]
  if (!flag) return true
  if (componentType === 'EMPLOYER_CONTRIB' && (componentCode === 'EOBI_R' || componentCode === 'PF_R')) {
    return !!statutory[flag]
  }
  if (componentType === 'DEDUCTION') return !!statutory[flag]
  return true
}

export function hasStatutoryDeductions(statutory: EmployeeStatutory): boolean {
  return statutory.eobi_enabled || statutory.pf_enabled || statutory.income_tax_enabled
}

/** Effective statutory enrollment for an employee on the payroll period end date. */
export async function loadEmployeeStatutoryForPeriod(
  employeeId: string,
  periodEnd: string
): Promise<EmployeeStatutory> {
  const { data } = await supabase
    .from('employee_statutory_enrollment')
    .select('*')
    .eq('employee_id', employeeId)
    .lte('effective_from', periodEnd)
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle()
  return parseStatutoryRow((data as Record<string, unknown> | null) ?? undefined)
}

export type AttendanceBucket = {
  present: number
  weekendWorked: number
  weeklyOffPaid: number
  absent: number
  paidLeave: number
  unpaidLeave: number
  holidays: number
  working: number
}

export type PayrollScope = {
  employeeIds?: string[]
  departmentId?: string
}

export type ComputedLine = {
  component_code: string
  component_name: string
  component_type: PayrollComponent['component_type']
  component_id: string | null
  amount: number
  base_amount: number | null
  formula_used: string | null
  sort_order: number
}

export type ComputedPayslip = {
  employee_id: string
  employee_code: string
  employee_name: string
  designation: string | null
  department: string | null
  branch: string | null
  days_in_period: number
  working_days: number
  present_days: number
  weekend_worked_days: number
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
  lines: ComputedLine[]
}

export type PreviewPayslipRow = ComputedPayslip & {
  salaryOk: boolean
  attendanceOk: boolean
  salaryLateEffective: boolean
  alreadyPosted: boolean
  weekdayPresent: number
  weeklyOffPaid: number
  totalPaidDays: number
}

export type PayrollRunResult = {
  runId: string
  payslipCount: number
  skippedCount: number
}

type DailyRow = {
  employee_id: string
  attendance_date?: string
  status: string
  is_weekly_off?: boolean
  is_holiday?: boolean
  first_in?: string | null
  worked_minutes?: number | null
}

type PayrollContext = {
  period: PayrollPeriod
  components: PayrollComponent[]
  slabs: TaxSlab[]
  employees: EmployeeForRun[]
  attByEmp: Map<string, AttendanceBucket>
  salaryByEmp: Map<string, Record<string, unknown>>
  salaryLateByEmp: Set<string>
  statutoryByEmp: Map<string, EmployeeStatutory>
  postedEmployeeIds: Set<string>
}

// =============================================================================
// Helpers
// =============================================================================
const round2 = (n: number) => Math.round(n * 100) / 100

function daysBetween(startIso: string, endIso: string): number {
  const s = new Date(startIso)
  const e = new Date(endIso)
  return Math.floor((e.getTime() - s.getTime()) / 86_400_000) + 1
}

function relName<T extends { name?: string; title?: string }>(v: unknown): T | null {
  if (Array.isArray(v)) return (v[0] as T) ?? null
  return (v as T) ?? null
}

function dayWasWorked(row: DailyRow): boolean {
  return row.first_in != null || Number(row.worked_minutes ?? 0) > 0
}

function isRestDayRow(row: DailyRow): boolean {
  return (
    row.status === 'Weekly Off' ||
    row.status === 'Holiday' ||
    !!row.is_weekly_off ||
    !!row.is_holiday
  )
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function periodDates(startIso: string, endIso: string): string[] {
  const out: string[] = []
  const [sy, sm, sd] = startIso.split('-').map(Number)
  const [ey, em, ed] = endIso.split('-').map(Number)
  let cur = Date.UTC(sy, sm - 1, sd)
  const end = Date.UTC(ey, em - 1, ed)
  while (cur <= end) {
    const dt = new Date(cur)
    out.push(
      `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
    )
    cur += 86_400_000
  }
  return out
}

function weekdayName(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return WEEKDAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
}

function isWeeklyOffStatus(s: string): boolean {
  return s === 'Weekly Off' || s === 'Holiday'
}

/** Weekday present, weekly-off rest (paid automatically), optional work on rest day. */
export function aggregateDailyRow(bucket: AttendanceBucket, row: DailyRow, weeklyOffDates: Set<string>) {
  const worked = dayWasWorked(row)
  const rest = isRestDayRow(row)
  const s = row.status
  const date = row.attendance_date

  if (s === 'Present' || s === 'Late') {
    if (rest) bucket.weekendWorked += 1
    else bucket.present += 1
  } else if (s === 'Half Day') {
    if (rest) bucket.weekendWorked += 0.5
    else bucket.present += 0.5
  } else if (s === 'Weekly Off' || (row.is_weekly_off && s !== 'Absent')) {
    if (date && !weeklyOffDates.has(date)) {
      bucket.weeklyOffPaid += 1
      weeklyOffDates.add(date)
    } else if (!date) {
      bucket.weeklyOffPaid += 1
    }
  } else if (isWeeklyOffStatus(s) && worked) {
    bucket.weekendWorked += 1
  } else if (s === 'Absent') {
    bucket.absent += 1
  }
}

/** Add scheduled weekly-off days from shift (e.g. Fridays) even when no attendance row exists. */
export function applyScheduledWeeklyOffs(
  bucket: AttendanceBucket,
  weeklyOffDates: Set<string>,
  weeklyOffDayNames: string[],
  periodStart: string,
  periodEnd: string
) {
  if (weeklyOffDayNames.length === 0) return
  for (const iso of periodDates(periodStart, periodEnd)) {
    if (!weeklyOffDayNames.includes(weekdayName(iso))) continue
    if (weeklyOffDates.has(iso)) continue
    bucket.weeklyOffPaid += 1
    weeklyOffDates.add(iso)
  }
}

export function totalPaidDays(att: AttendanceBucket): number {
  return att.present + att.weekendWorked + att.weeklyOffPaid + att.paidLeave + att.holidays
}

/** Present, rest-day work, or approved paid leave — required before weekly offs / holidays count as paid. */
export function hasQualifyingPayrollActivity(att: AttendanceBucket): boolean {
  return att.present + att.weekendWorked + att.paidLeave > 0
}

/** Credit company holidays and shift weekly offs only when the employee worked or had paid leave in the period. */
export function finalizeAttendanceForPayroll(
  bucket: AttendanceBucket,
  weeklyOffDates: Set<string>,
  weeklyOffDayNames: string[],
  periodStart: string,
  periodEnd: string,
  holidaysCount: number
) {
  if (!hasQualifyingPayrollActivity(bucket)) {
    bucket.weeklyOffPaid = 0
    bucket.holidays = 0
    return
  }
  bucket.holidays = holidaysCount
  applyScheduledWeeklyOffs(bucket, weeklyOffDates, weeklyOffDayNames, periodStart, periodEnd)
}

export function computeMonthlyTax(annualTaxable: number, slabs: TaxSlab[]): number {
  if (annualTaxable <= 0 || slabs.length === 0) return 0
  const ordered = [...slabs].sort((a, b) => a.slab_from - b.slab_from)
  for (const s of ordered) {
    const within = annualTaxable > s.slab_from && (s.slab_to === null || annualTaxable <= s.slab_to)
    if (within) {
      const excess = annualTaxable - s.slab_from
      const annualTax = Number(s.base_tax) + (excess * Number(s.rate_pct)) / 100
      return round2(annualTax / 12)
    }
  }
  return 0
}

export function monthlyEquivalent(value: number, frequency: string): number {
  const f = frequency.trim().toLowerCase()
  if (f === 'weekly') return value * (52 / 12)
  if (f === 'fortnightly' || f === 'semi_monthly' || f === 'semi-monthly') return value * 2
  return value
}

/** Amount for this payroll period from compensation (respects pay frequency). */
export function periodPayAmount(
  value: number,
  frequency: string,
  paidDays: number,
  workingDays: number
): number {
  if (value <= 0 || paidDays <= 0 || workingDays <= 0) return 0
  const ratio = paidDays / workingDays
  const f = frequency.trim().toLowerCase()
  if (f === 'fortnightly' || f === 'semi_monthly' || f === 'semi-monthly') {
    return round2(value * ratio)
  }
  if (f === 'weekly') {
    return round2(value * (52 / 12) * ratio)
  }
  return round2(value * ratio)
}

/** Pick compensation row for a payroll period; falls back to latest record if effective date is after period. */
export function pickSalaryForPeriod(
  rows: Array<Record<string, unknown>>,
  periodStart: string,
  periodEnd: string
): Map<string, { row: Record<string, unknown>; lateEffective: boolean }> {
  const grouped = new Map<string, Array<Record<string, unknown>>>()
  for (const row of rows) {
    const empId = row.employee_id as string
    if (!grouped.has(empId)) grouped.set(empId, [])
    grouped.get(empId)!.push(row)
  }

  const result = new Map<string, { row: Record<string, unknown>; lateEffective: boolean }>()
  for (const [empId, empRows] of grouped) {
    const sorted = [...empRows].sort((a, b) =>
      String(b.effective_from).localeCompare(String(a.effective_from))
    )
    const inPeriod = sorted.find((row) => {
      const from = row.effective_from as string
      const to = row.effective_to as string | null
      if (from > periodEnd) return false
      if (to && to < periodStart) return false
      return true
    })
    if (inPeriod) {
      result.set(empId, { row: inPeriod, lateEffective: false })
      continue
    }
    const fallback = sorted[0]
    if (fallback) {
      const from = fallback.effective_from as string
      result.set(empId, { row: fallback, lateEffective: from > periodEnd })
    }
  }
  return result
}

function empToForRun(emp: Record<string, unknown>, sal: Record<string, unknown>): EmployeeForRun {
  return {
    id: emp.id as string,
    employee_code: emp.employee_code as string,
    full_name: emp.full_name as string,
    date_of_joining: (emp.date_of_joining as string) ?? null,
    branch_id: (emp.branch_id as string) ?? null,
    department_id: (emp.department_id as string) ?? null,
    designation_id: (emp.designation_id as string) ?? null,
    branches: relName<{ name: string }>(emp.branches),
    departments: relName<{ name: string }>(emp.departments),
    designations: relName<{ title: string }>(emp.designations),
    basic: Number(sal.basic) || 0,
    house_rent: Number(sal.house_rent) || 0,
    medical: Number(sal.medical) || 0,
    conveyance: Number(sal.conveyance) || 0,
    utilities: Number(sal.utilities) || 0,
    other_allowances: Number(sal.other_allowances) || 0,
    pay_frequency: (sal.pay_frequency as string) || 'MONTHLY',
    ...parseCompAllowances(sal),
  }
}

// =============================================================================
// Compute one payslip
// =============================================================================
export function computePayslip(
  employee: EmployeeForRun,
  period: PayrollPeriod,
  components: PayrollComponent[],
  slabs: TaxSlab[],
  attendance: AttendanceBucket,
  statutory: EmployeeStatutory = defaultEmployeeStatutory()
): ComputedPayslip {
  const daysInPeriod = daysBetween(period.period_start, period.period_end)
  const working = attendance.working || daysInPeriod
  const paidDays = totalPaidDays(attendance)
  const proRate = Math.max(0, Math.min(1, paidDays / working))

  const freq = employee.pay_frequency || 'Monthly'
  const fullBasic = monthlyEquivalent(Number(employee.basic) || 0, freq)
  const basic = periodPayAmount(Number(employee.basic) || 0, freq, paidDays, working)

  const lines: ComputedLine[] = []
  const byCode = (code: string) => components.find((c) => c.code === code && c.is_active)

  const pushLine = (
    cd: PayrollComponent | undefined,
    amount: number,
    base?: number,
    formula?: string,
    fallback?: { code: string; name: string; type: PayrollComponent['component_type']; sort: number }
  ) => {
    const amt = round2(amount)
    if (cd) {
      if (amt === 0 && !cd.is_system) return
      lines.push({
        component_id: cd.id,
        component_code: cd.code,
        component_name: cd.name,
        component_type: cd.component_type,
        amount: amt,
        base_amount: base != null ? round2(base) : null,
        formula_used: formula ?? null,
        sort_order: cd.sort_order,
      })
      return
    }
    if (!fallback || (amt === 0 && fallback.code !== 'BASIC')) return
    lines.push({
      component_id: null,
      component_code: fallback.code,
      component_name: fallback.name,
      component_type: fallback.type,
      amount: amt,
      base_amount: base != null ? round2(base) : null,
      formula_used: formula ?? null,
      sort_order: fallback.sort,
    })
  }

  pushLine(
    byCode('BASIC'),
    basic,
    fullBasic,
    `${(proRate * 100).toFixed(1)}% of ${fullBasic.toFixed(2)}`,
    { code: 'BASIC', name: 'Basic salary', type: 'EARNING', sort: 10 }
  )

  const fixedFromEmp = (key: keyof EmployeeForRun) =>
    periodPayAmount(Number(employee[key]) || 0, freq, paidDays, working)

  if (employee.house_rent_enabled) {
    pushLine(byCode('HRA'), fixedFromEmp('house_rent'), undefined, undefined, {
      code: 'HRA',
      name: 'House rent allowance',
      type: 'EARNING',
      sort: 20,
    })
  }
  if (employee.medical_enabled) {
    pushLine(byCode('MED'), fixedFromEmp('medical'), undefined, undefined, {
      code: 'MED',
      name: 'Medical allowance',
      type: 'EARNING',
      sort: 30,
    })
  }
  if (employee.conveyance_enabled) {
    pushLine(byCode('CONV'), fixedFromEmp('conveyance'), undefined, undefined, {
      code: 'CONV',
      name: 'Conveyance allowance',
      type: 'EARNING',
      sort: 40,
    })
  }
  if (employee.utilities_enabled) {
    pushLine(byCode('UTIL'), fixedFromEmp('utilities'), undefined, undefined, {
      code: 'UTIL',
      name: 'Utilities allowance',
      type: 'EARNING',
      sort: 50,
    })
  }
  if (employee.other_allowances_enabled) {
    pushLine(byCode('OTH'), fixedFromEmp('other_allowances'), undefined, undefined, {
      code: 'OTH',
      name: 'Other allowances / incentive',
      type: 'EARNING',
      sort: 60,
    })
  }

  const grossEarnings = lines.filter((l) => l.component_type === 'EARNING').reduce((s, l) => s + l.amount, 0)

  const lopDays = attendance.unpaidLeave + attendance.absent
  if (lopDays > 0) {
    pushLine(byCode('LOP'), 0, fullBasic, `${lopDays} day(s) unpaid`)
  }

  let tax = 0

  if (statutory.eobi_enabled) {
    const eobiE = byCode('EOBI_E')
    const eobiAmt =
      statutory.eobi_custom_amount != null
        ? statutory.eobi_custom_amount
        : Number(eobiE?.calc_value ?? 370)
    if (eobiE) pushLine(eobiE, round2(eobiAmt))
    const eobiR = byCode('EOBI_R')
    if (eobiR) pushLine(eobiR, round2(Number(eobiR.calc_value)))
  }

  if (statutory.pf_enabled) {
    const pfE = byCode('PF_E')
    const pfEmpPct = statutory.pf_employee_pct ?? Number(pfE?.calc_value ?? 8.33)
    if (pfE) {
      pushLine(pfE, round2((basic * pfEmpPct) / 100), basic, `${pfEmpPct}% of basic`)
    }
    const pfR = byCode('PF_R')
    const pfErPct = statutory.pf_employer_pct ?? Number(pfR?.calc_value ?? 8.33)
    if (pfR) {
      pushLine(pfR, round2((basic * pfErPct) / 100), basic, `${pfErPct}% of basic`)
    }
  }

  if (statutory.income_tax_enabled) {
    const taxableLines = lines.filter((l) => {
      const c = components.find((x) => x.id === l.component_id)
      return c?.is_taxable && l.component_type === 'EARNING'
    })
    const monthlyTaxable = taxableLines.reduce((s, l) => s + l.amount, 0)
    tax = computeMonthlyTax(monthlyTaxable * 12, slabs)
    pushLine(byCode('TAX'), tax, monthlyTaxable, `Slab on annual ${(monthlyTaxable * 12).toFixed(0)}`)
  }

  const totalDeductions = lines.filter((l) => l.component_type === 'DEDUCTION').reduce((s, l) => s + l.amount, 0)
  const employerContrib = lines.filter((l) => l.component_type === 'EMPLOYER_CONTRIB').reduce((s, l) => s + l.amount, 0)
  const netPay = round2(grossEarnings - totalDeductions)

  const totalPresent = attendance.present + attendance.weekendWorked + attendance.weeklyOffPaid

  return {
    employee_id: employee.id,
    employee_code: employee.employee_code,
    employee_name: employee.full_name,
    designation: employee.designations?.title ?? null,
    department: employee.departments?.name ?? null,
    branch: employee.branches?.name ?? null,
    days_in_period: daysInPeriod,
    working_days: working,
    present_days: totalPresent,
    weekend_worked_days: attendance.weeklyOffPaid,
    paid_leave_days: attendance.paidLeave,
    unpaid_leave_days: attendance.unpaidLeave,
    absent_days: attendance.absent,
    holidays_count: attendance.holidays,
    basic,
    gross_earnings: round2(grossEarnings),
    total_deductions: round2(totalDeductions),
    employer_contrib: round2(employerContrib),
    tax_amount: tax,
    eobi_employee: lines.find((l) => l.component_code === 'EOBI_E')?.amount ?? 0,
    eobi_employer: lines.find((l) => l.component_code === 'EOBI_R')?.amount ?? 0,
    pf_employee: lines.find((l) => l.component_code === 'PF_E')?.amount ?? 0,
    pf_employer: lines.find((l) => l.component_code === 'PF_R')?.amount ?? 0,
    net_pay: netPay,
    lines: lines.sort((a, b) => a.sort_order - b.sort_order),
  }
}

// =============================================================================
// Load payroll context
// =============================================================================
export async function loadPayrollContext(
  periodId: string,
  companyId: string,
  scope?: PayrollScope
): Promise<PayrollContext> {
  const { data: period, error: pe } = await supabase.from('payroll_periods').select('*').eq('id', periodId).single()
  if (pe || !period) throw new Error(pe?.message || 'Period not found')

  let empQuery = supabase
    .from('employees')
    .select(
      `id, employee_code, full_name, date_of_joining, branch_id, department_id, designation_id,
       branches(name), departments(name), designations(title)`
    )
    .eq('company_id', companyId)
    .eq('is_active', true)

  if (scope?.departmentId) empQuery = empQuery.eq('department_id', scope.departmentId)
  if (scope?.employeeIds?.length) empQuery = empQuery.in('id', scope.employeeIds)

  const [{ data: comps }, { data: slabsRaw }, { data: emps }, { data: posted }] = await Promise.all([
      supabase.from('payroll_components').select('*').eq('company_id', companyId).eq('is_active', true),
      supabase.from('tax_slabs').select('*').eq('company_id', companyId).eq('applies_to', 'SALARIED').order('slab_from'),
      empQuery,
      supabase.from('payslips').select('employee_id').eq('period_id', periodId),
    ])

  const empIds = (emps ?? []).map((e) => e.id)
  const emptyEmp = '00000000-0000-0000-0000-000000000000'

  const [{ data: salaries }, { data: daily }, { data: leaves }, { data: holList }, { data: shiftRows }, { data: statutoryRows }] =
    await Promise.all([
      supabase
        .from('employee_salary_history')
        .select('*')
        .in('employee_id', empIds.length ? empIds : [emptyEmp])
        .order('effective_from', { ascending: false }),
    supabase
      .from('attendance_daily')
      .select('employee_id, attendance_date, status, is_weekly_off, is_holiday, first_in, worked_minutes')
      .gte('attendance_date', period.period_start)
      .lte('attendance_date', period.period_end)
      .in('employee_id', empIds.length ? empIds : ['00000000-0000-0000-0000-000000000000']),
    supabase
      .from('leave_applications')
      .select('employee_id, start_date, end_date, total_days, status, leave_types(is_paid)')
      .lte('start_date', period.period_end)
      .gte('end_date', period.period_start)
      .eq('status', 'Approved')
      .in('employee_id', empIds.length ? empIds : ['00000000-0000-0000-0000-000000000000']),
    supabase
      .from('holidays')
      .select('holiday_date')
      .gte('holiday_date', period.period_start)
      .lte('holiday_date', period.period_end),
    supabase
      .from('employee_shift_assignments')
      .select('employee_id, weekly_off, effective_from, effective_to')
      .in('employee_id', empIds.length ? empIds : ['00000000-0000-0000-0000-000000000000'])
      .lte('effective_from', period.period_end)
      .order('effective_from', { ascending: false }),
    supabase
      .from('employee_statutory_enrollment')
      .select('*')
      .in('employee_id', empIds.length ? empIds : ['00000000-0000-0000-0000-000000000000'])
      .order('effective_from', { ascending: false }),
  ])

  const salaryPicks = pickSalaryForPeriod(
    (salaries ?? []) as Array<Record<string, unknown>>,
    period.period_start,
    period.period_end
  )
  const salaryByEmp = new Map<string, Record<string, unknown>>()
  const salaryLateByEmp = new Set<string>()
  for (const [empId, pick] of salaryPicks) {
    salaryByEmp.set(empId, pick.row)
    if (pick.lateEffective) salaryLateByEmp.add(empId)
  }

  const weeklyOffByEmp = new Map<string, string[]>()
  for (const row of shiftRows ?? []) {
    const empId = row.employee_id as string
    if (weeklyOffByEmp.has(empId)) continue
    const efTo = row.effective_to as string | null
    if (efTo && efTo < period.period_start) continue
    weeklyOffByEmp.set(empId, (row.weekly_off as string[]) ?? [])
  }

  const daysInPeriod = daysBetween(period.period_start, period.period_end)
  const holidaysCount = (holList ?? []).length
  const attByEmp = new Map<string, AttendanceBucket>()
  const weeklyOffDatesByEmp = new Map<string, Set<string>>()

  for (const e of emps ?? []) {
    attByEmp.set(e.id, {
      present: 0,
      weekendWorked: 0,
      weeklyOffPaid: 0,
      absent: 0,
      paidLeave: 0,
      unpaidLeave: 0,
      holidays: 0,
      working: daysInPeriod - holidaysCount,
    })
    weeklyOffDatesByEmp.set(e.id, new Set())
  }

  for (const d of daily ?? []) {
    const row = d as DailyRow
    const bucket = attByEmp.get(row.employee_id)
    if (!bucket) continue
    const dates = weeklyOffDatesByEmp.get(row.employee_id)!
    aggregateDailyRow(bucket, row, dates)
  }

  for (const lv of leaves ?? []) {
    const r = lv as {
      employee_id: string
      total_days: number
      leave_types: { is_paid: boolean } | { is_paid: boolean }[]
    }
    const lt = Array.isArray(r.leave_types) ? r.leave_types[0] : r.leave_types
    const bucket = attByEmp.get(r.employee_id)
    if (!bucket) continue
    if (lt?.is_paid) bucket.paidLeave += Number(r.total_days)
    else bucket.unpaidLeave += Number(r.total_days)
  }

  for (const e of emps ?? []) {
    const bucket = attByEmp.get(e.id)
    const dates = weeklyOffDatesByEmp.get(e.id)
    if (!bucket || !dates) continue
    finalizeAttendanceForPayroll(
      bucket,
      dates,
      weeklyOffByEmp.get(e.id) ?? [],
      period.period_start,
      period.period_end,
      holidaysCount
    )
  }

  const statutoryByEmp = new Map<string, EmployeeStatutory>()
  const statGrouped = new Map<string, Array<Record<string, unknown>>>()
  for (const row of (statutoryRows ?? []) as Array<Record<string, unknown>>) {
    const empId = row.employee_id as string
    if (!statGrouped.has(empId)) statGrouped.set(empId, [])
    statGrouped.get(empId)!.push(row)
  }
  for (const empId of empIds) {
    const sorted = (statGrouped.get(empId) ?? []).sort((a, b) =>
      String(b.effective_from).localeCompare(String(a.effective_from))
    )
    const inPeriod = sorted.find((row) => {
      const from = row.effective_from as string
      return from <= period.period_end
    })
    const pick = inPeriod ?? sorted[0]
    if (pick) statutoryByEmp.set(empId, parseStatutoryRow(pick))
  }

  const employees: EmployeeForRun[] = (emps ?? []).map((emp) =>
    empToForRun(emp as Record<string, unknown>, salaryByEmp.get(emp.id) || {})
  )

  return {
    period: period as PayrollPeriod,
    components: (comps ?? []) as unknown as PayrollComponent[],
    slabs: (slabsRaw ?? []) as unknown as TaxSlab[],
    employees,
    attByEmp,
    salaryByEmp,
    salaryLateByEmp,
    statutoryByEmp,
    postedEmployeeIds: new Set((posted ?? []).map((p) => p.employee_id as string)),
  }
}

// =============================================================================
// Pre-run validation
// =============================================================================
export type PayrollRunValidation = {
  warnings: string[]
  missingSalary: { employee_code: string; full_name: string }[]
}

export async function validatePayrollRun(periodId: string, companyId: string, scope?: PayrollScope): Promise<PayrollRunValidation> {
  const ctx = await loadPayrollContext(periodId, companyId, scope)
  const missingSalary: PayrollRunValidation['missingSalary'] = []

  for (const emp of ctx.employees) {
    const sal = ctx.salaryByEmp.get(emp.id)
    if (!sal || Number(sal.basic) <= 0) {
      missingSalary.push({ employee_code: emp.employee_code, full_name: emp.full_name })
    }
  }

  const warnings: string[] = []
  if (ctx.components.length === 0) {
    warnings.push(
      'Payroll components are not configured for this company. Earnings and deductions will be empty until components are seeded (Payroll → Components or run migration 0052).'
    )
  }
  if (ctx.slabs.length === 0) {
    warnings.push('Income tax slabs are not configured. Tax will be calculated as Rs 0 until tax slabs are seeded.')
  }
  if (missingSalary.length > 0) {
    const sample = missingSalary
      .slice(0, 5)
      .map((e) => `${e.full_name} (${e.employee_code})`)
      .join(', ')
    const more = missingSalary.length > 5 ? ` and ${missingSalary.length - 5} more` : ''
    warnings.push(
      `${missingSalary.length} active employee(s) have no compensation on file (e.g. ${sample}${more}). They will be skipped when posting.`
    )
  }
  if (ctx.salaryLateByEmp.size > 0) {
    warnings.push(
      `${ctx.salaryLateByEmp.size} employee(s) use compensation whose effective date is after this period end. Salary is included using their latest record — set Effective from on or before ${ctx.period.period_end} in Compensation for correct period matching.`
    )
  }

  return { warnings, missingSalary }
}

// =============================================================================
// Preview (no persist)
// =============================================================================
export async function previewPayrollRun(
  periodId: string,
  companyId: string,
  scope?: PayrollScope,
  options?: { includePosted?: boolean }
): Promise<PreviewPayslipRow[]> {
  const ctx = await loadPayrollContext(periodId, companyId, scope)
  const includePosted = options?.includePosted ?? false
  const rows: PreviewPayslipRow[] = []

  for (const employee of ctx.employees) {
    const alreadyPosted = ctx.postedEmployeeIds.has(employee.id)
    if (alreadyPosted && !includePosted) continue

    const att = ctx.attByEmp.get(employee.id) || {
      present: 0,
      weekendWorked: 0,
      weeklyOffPaid: 0,
      absent: 0,
      paidLeave: 0,
      unpaidLeave: 0,
      holidays: 0,
      working: daysBetween(ctx.period.period_start, ctx.period.period_end),
    }
    const sal = ctx.salaryByEmp.get(employee.id)
    const salaryOk = !!sal && Number(sal.basic) > 0
    const paidDays = totalPaidDays(att)
    const slip = computePayslip(
      employee,
      ctx.period,
      ctx.components,
      ctx.slabs,
      att,
      ctx.statutoryByEmp.get(employee.id) ?? defaultEmployeeStatutory()
    )

    rows.push({
      ...slip,
      salaryOk,
      attendanceOk: paidDays > 0,
      salaryLateEffective: ctx.salaryLateByEmp.has(employee.id),
      alreadyPosted,
      weekdayPresent: att.present,
      weeklyOffPaid: att.weeklyOffPaid,
      totalPaidDays: paidDays,
    })
  }

  return rows.sort((a, b) => a.employee_code.localeCompare(b.employee_code))
}

// =============================================================================
// Persist helpers
// =============================================================================
async function getOrCreateOpenRun(periodId: string, companyId: string): Promise<string> {
  const { data: existing } = await supabase
    .from('payroll_runs')
    .select('id')
    .eq('period_id', periodId)
    .in('status', ['PROCESSING', 'COMPLETED'])
    .order('run_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing?.id) return existing.id

  const { data: runRow, error: rErr } = await supabase
    .from('payroll_runs')
    .insert({ company_id: companyId, period_id: periodId, status: 'PROCESSING' })
    .select('id')
    .single()
  if (rErr || !runRow) throw new Error(rErr?.message || 'Failed to create run')
  return runRow.id
}

async function refreshRunTotals(runId: string) {
  const { data: slips } = await supabase
    .from('payslips')
    .select('gross_earnings, total_deductions, employer_contrib, net_pay')
    .eq('run_id', runId)

  const list = slips ?? []
  await supabase
    .from('payroll_runs')
    .update({
      status: 'COMPLETED',
      total_employees: list.length,
      total_gross: round2(list.reduce((s, x) => s + Number(x.gross_earnings), 0)),
      total_deductions: round2(list.reduce((s, x) => s + Number(x.total_deductions), 0)),
      total_employer_cost: round2(list.reduce((s, x) => s + Number(x.employer_contrib), 0)),
      total_net: round2(list.reduce((s, x) => s + Number(x.net_pay), 0)),
    })
    .eq('id', runId)
}

async function insertOnePayslip(
  companyId: string,
  periodId: string,
  runId: string,
  slip: ComputedPayslip
) {
  const { data: psRow, error: psErr } = await supabase
    .from('payslips')
    .insert({
      company_id: companyId,
      run_id: runId,
      period_id: periodId,
      employee_id: slip.employee_id,
      employee_code: slip.employee_code,
      employee_name: slip.employee_name,
      designation: slip.designation,
      department: slip.department,
      branch: slip.branch,
      days_in_period: slip.days_in_period,
      working_days: slip.working_days,
      present_days: slip.present_days,
      paid_leave_days: slip.paid_leave_days,
      unpaid_leave_days: slip.unpaid_leave_days,
      absent_days: slip.absent_days,
      holidays_count: slip.holidays_count,
      basic: slip.basic,
      gross_earnings: slip.gross_earnings,
      total_deductions: slip.total_deductions,
      employer_contrib: slip.employer_contrib,
      tax_amount: slip.tax_amount,
      eobi_employee: slip.eobi_employee,
      eobi_employer: slip.eobi_employer,
      pf_employee: slip.pf_employee,
      pf_employer: slip.pf_employer,
      net_pay: slip.net_pay,
      status: 'DRAFT',
    })
    .select('id')
    .single()
  if (psErr || !psRow) throw new Error(psErr?.message || 'Failed to insert payslip')

  if (slip.lines.length > 0) {
    const { error: lErr } = await supabase.from('payslip_lines').insert(
      slip.lines.map((l) => ({
        payslip_id: psRow.id,
        component_id: l.component_id,
        component_code: l.component_code,
        component_name: l.component_name,
        component_type: l.component_type,
        amount: l.amount,
        base_amount: l.base_amount,
        formula_used: l.formula_used,
        sort_order: l.sort_order,
      }))
    )
    if (lErr) throw new Error(lErr.message)
  }
}

// =============================================================================
// Run payroll (persist)
// =============================================================================
export async function runPayrollForPeriod(
  periodId: string,
  companyId: string,
  scope?: PayrollScope,
  options?: { finalizePeriod?: boolean; replaceExisting?: boolean }
): Promise<PayrollRunResult> {
  const finalizePeriod = options?.finalizePeriod ?? !scope
  const replaceExisting = options?.replaceExisting ?? false
  const ctx = await loadPayrollContext(periodId, companyId, scope)

  if (ctx.employees.length === 0) throw new Error('No employees match the selected scope')

  const runId = await getOrCreateOpenRun(periodId, companyId)
  let payslipCount = 0
  let skippedCount = 0

  for (const employee of ctx.employees) {
    if (ctx.postedEmployeeIds.has(employee.id)) {
      if (!replaceExisting) {
        skippedCount++
        continue
      }
      const { data: old } = await supabase
        .from('payslips')
        .select('id')
        .eq('period_id', periodId)
        .eq('employee_id', employee.id)
      for (const row of old ?? []) {
        await supabase.from('payslip_lines').delete().eq('payslip_id', row.id)
        await supabase.from('payslips').delete().eq('id', row.id)
      }
    }

    const sal = ctx.salaryByEmp.get(employee.id)
    if (!sal || Number(sal.basic) <= 0) {
      skippedCount++
      continue
    }

    const att = ctx.attByEmp.get(employee.id)!
    if (totalPaidDays(att) <= 0) {
      skippedCount++
      continue
    }
    const slip = computePayslip(
      employee,
      ctx.period,
      ctx.components,
      ctx.slabs,
      att,
      ctx.statutoryByEmp.get(employee.id) ?? defaultEmployeeStatutory()
    )
    await insertOnePayslip(companyId, periodId, runId, slip)
    payslipCount++
  }

  await refreshRunTotals(runId)

  if (finalizePeriod) {
    await supabase
      .from('payroll_periods')
      .update({ status: 'FINALIZED', finalized_at: new Date().toISOString() })
      .eq('id', periodId)
  }

  return { runId, payslipCount, skippedCount }
}

/** Release DRAFT payslips for a period (optionally filtered by department name or employee ids). */
export async function releasePayslips(
  periodId: string,
  filter?: { departmentName?: string; employeeIds?: string[] }
): Promise<number> {
  let q = supabase.from('payslips').select('id, department').eq('period_id', periodId).eq('status', 'DRAFT')
  const { data, error } = await q
  if (error) throw new Error(error.message)

  let ids = (data ?? []).map((p) => p.id as string)
  if (filter?.departmentName) {
    const dept = filter.departmentName
    ids = (data ?? []).filter((p) => p.department === dept).map((p) => p.id as string)
  }
  if (filter?.employeeIds?.length) {
    const { data: byEmp } = await supabase
      .from('payslips')
      .select('id')
      .eq('period_id', periodId)
      .eq('status', 'DRAFT')
      .in('employee_id', filter.employeeIds)
    ids = (byEmp ?? []).map((p) => p.id as string)
  }

  if (ids.length === 0) return 0

  const { error: upErr } = await supabase.from('payslips').update({ status: 'FINAL' }).in('id', ids)
  if (upErr) throw new Error(upErr.message)
  return ids.length
}

export const fmtPKR = (n: number) =>
  new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 }).format(n)
