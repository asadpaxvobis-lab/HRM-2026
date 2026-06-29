// =============================================================================
// Letter token rendering
// Supports {{variable_name}} substitution. Unknown tokens are left as-is so
// the author can spot them in the preview and fill them by hand if needed.
// =============================================================================

import { supabase } from '@/lib/supabase'

export const LETTER_TYPES = [
  'OFFER',
  'APPOINTMENT',
  'CONFIRMATION',
  'PROMOTION',
  'EXPERIENCE',
  'SALARY_CERTIFICATE',
  'NOC',
  'WARNING',
  'TERMINATION',
  'RELIEVING',
  'TRANSFER',
  'GENERAL',
] as const

export type LetterType = (typeof LETTER_TYPES)[number]

export const LETTER_TYPE_LABELS: Record<LetterType, string> = {
  OFFER: 'Offer',
  APPOINTMENT: 'Appointment',
  CONFIRMATION: 'Confirmation',
  PROMOTION: 'Promotion',
  EXPERIENCE: 'Experience',
  SALARY_CERTIFICATE: 'Salary certificate',
  NOC: 'NOC',
  WARNING: 'Warning',
  TERMINATION: 'Termination',
  RELIEVING: 'Relieving',
  TRANSFER: 'Transfer',
  GENERAL: 'General',
}

/**
 * Tokens that compose() will replace. Keys are the variable names users write
 * inside double-curly braces in their templates.
 */
export const AVAILABLE_TOKENS = [
  // Employee
  { token: 'employee_name', label: 'Employee full name' },
  { token: 'employee_code', label: 'Employee code' },
  { token: 'first_name', label: 'First name' },
  { token: 'last_name', label: 'Last name' },
  { token: 'designation', label: 'Designation / job title' },
  { token: 'department', label: 'Department name' },
  { token: 'branch', label: 'Branch / location name' },
  { token: 'date_of_joining', label: 'Date of joining' },
  { token: 'cnic', label: 'CNIC / national ID' },
  { token: 'email', label: 'Email address' },
  { token: 'phone', label: 'Phone' },
  // Salary
  { token: 'salary_basic', label: 'Basic salary' },
  { token: 'salary_house_rent', label: 'House rent' },
  { token: 'salary_medical', label: 'Medical' },
  { token: 'salary_conveyance', label: 'Conveyance' },
  { token: 'salary_utilities', label: 'Utilities' },
  { token: 'salary_allowances', label: 'Other allowances' },
  { token: 'salary_gross', label: 'Gross monthly salary' },
  // Company
  { token: 'company_name', label: 'Company name' },
  { token: 'company_address', label: 'Company address' },
  // Date / freeform
  { token: 'date_today', label: "Today's date" },
  { token: 'purpose', label: 'Purpose (free text — fill before issue)' },
  { token: 'warning_reason', label: 'Warning / termination reason (free text)' },
]

export type TokenMap = Record<string, string>

const fmtDate = (s: string | null | undefined) => {
  if (!s) return ''
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
}

const fmtMoney = (n: number | null | undefined) => {
  if (n == null) return '0'
  return Number(n).toLocaleString('en-PK', { maximumFractionDigits: 0 })
}

/**
 * Build a token map for one employee. Salary is pulled from the latest open
 * `employee_salary_history` row. Company info comes from `companies`.
 */
export async function buildTokenMapForEmployee(employeeId: string): Promise<TokenMap> {
  const [{ data: emp }, { data: sal }] = await Promise.all([
    supabase
      .from('employees')
      .select(`*,
        branches(name),
        departments(name),
        designations(title),
        companies(name, address)`)
      .eq('id', employeeId)
      .single(),
    supabase
      .from('employee_salary_history')
      .select('*')
      .eq('employee_id', employeeId)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const e: Record<string, unknown> = (emp ?? {}) as Record<string, unknown>
  const pick = (key: string) => {
    const v = e[key]
    return Array.isArray(v) ? (v[0] as Record<string, unknown> | undefined) : (v as Record<string, unknown> | undefined)
  }
  const branch = pick('branches')
  const department = pick('departments')
  const designation = pick('designations')
  const company = pick('companies')

  const salRow = (sal ?? {}) as Record<string, unknown>
  const basic = Number(salRow.basic ?? 0)
  const hr = Number(salRow.house_rent ?? 0)
  const med = Number(salRow.medical ?? 0)
  const conv = Number(salRow.conveyance ?? 0)
  const util = Number(salRow.utilities ?? 0)
  const other = Number(salRow.other_allowances ?? 0)
  const gross = basic + hr + med + conv + util + other
  const allowancesSum = med + conv + util + other

  return {
    employee_name: String(e.full_name ?? ''),
    employee_code: String(e.employee_code ?? ''),
    first_name: String(e.first_name ?? ''),
    last_name: String(e.last_name ?? ''),
    designation: designation?.title ? String(designation.title) : '',
    department: department?.name ? String(department.name) : '',
    branch: branch?.name ? String(branch.name) : '',
    date_of_joining: fmtDate(e.date_of_joining as string | null),
    cnic: String(e.cnic ?? ''),
    email: String(e.email ?? ''),
    phone: String(e.phone ?? ''),
    salary_basic: fmtMoney(basic),
    salary_house_rent: fmtMoney(hr),
    salary_medical: fmtMoney(med),
    salary_conveyance: fmtMoney(conv),
    salary_utilities: fmtMoney(util),
    salary_allowances: fmtMoney(allowancesSum),
    salary_gross: fmtMoney(gross),
    company_name: company?.name ? String(company.name) : 'Company',
    company_address: company?.address ? String(company.address) : '',
    date_today: fmtDate(new Date().toISOString()),
  }
}

/** Sample values for template preview (no employee selected). */
export function buildSampleTokenMap(): TokenMap {
  return {
    employee_name: 'Muhammad Ali Khan',
    employee_code: 'EMP-0042',
    first_name: 'Muhammad',
    last_name: 'Khan',
    designation: 'Production Supervisor',
    department: 'Packing',
    branch: 'Godown 1',
    date_of_joining: '15 January 2024',
    cnic: '35201-1234567-1',
    email: 'ali.khan@company.com',
    phone: '0300-1234567',
    salary_basic: '45,000',
    salary_house_rent: '12,000',
    salary_medical: '3,000',
    salary_conveyance: '2,500',
    salary_utilities: '0',
    salary_allowances: '5,500',
    salary_gross: '62,500',
    company_name: 'Your Company Name',
    company_address: '123 Industrial Area, Lahore, Pakistan',
    date_today: fmtDate(new Date().toISOString()),
    purpose: '[purpose / reason]',
    warning_reason: '[reason for warning or termination]',
  }
}

/**
 * Replace {{token}} placeholders. Whitespace inside the braces is tolerated.
 * Tokens not present in the map are left untouched so the author notices.
 */
export function renderTemplate(template: string, tokens: TokenMap): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, name: string) => {
    const v = tokens[name]
    return v !== undefined && v !== '' ? v : match
  })
}

/** Returns the list of unresolved tokens still present in a rendered body. */
export function findUnresolvedTokens(rendered: string): string[] {
  const matches = rendered.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)
  return Array.from(new Set(Array.from(matches, (m) => m[1])))
}
