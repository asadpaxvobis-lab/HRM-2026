import type { SupabaseClient } from '@supabase/supabase-js'

export type EmployeeBasicPay = {
  basic: number
  currency: string
}

export type OtPayContext = {
  ok: boolean
  basic: number
  currency: string
  hourly_rate: number
  request_amount: number
  month_hours: number
  month_amount: number
  month_total_hours: number
  month_total_amount: number
  error?: string
}

export type OtPayComputed = {
  basic: number
  currency: string
  hourly_rate: number
  request_amount: number
}

/** Always uses client formula: basic ÷ (month days × 8) × hours × multiplier */
export async function computeOtPayAmount(
  supabase: SupabaseClient,
  employeeId: string,
  otDate: string,
  plannedHours: number,
  rateMultiplier: number
): Promise<{ data: OtPayComputed | null; error: string | null }> {
  const pay = await fetchEmployeeBasicPay(supabase, employeeId, otDate)
  if (pay.error) return { data: null, error: pay.error }
  if (!pay.data || pay.data.basic <= 0) return { data: null, error: null }

  const mult = rateMultiplier > 0 ? rateMultiplier : 1
  const hourly_rate = hourlyRateFromBasic(pay.data.basic, otDate)
  const request_amount = overtimePayAmount(plannedHours, hourly_rate, mult)

  return {
    data: {
      basic: pay.data.basic,
      currency: pay.data.currency,
      hourly_rate,
      request_amount,
    },
    error: null,
  }
}

/** Salary + month totals from RPC when available; pay amount always from client formula. */
export async function fetchOtPayContext(
  supabase: SupabaseClient,
  employeeId: string,
  otDate: string,
  plannedHours: number,
  rateMultiplier: number,
  excludeRequestId?: string | null
): Promise<{ data: OtPayContext | null; error: string | null }> {
  const mult = rateMultiplier > 0 ? rateMultiplier : 1
  const local = await computeOtPayAmount(supabase, employeeId, otDate, plannedHours, mult)
  if (local.error) return { data: null, error: local.error }
  if (!local.data) return { data: null, error: null }

  let month_hours = 0
  let month_amount = 0

  const { data, error } = await supabase.rpc('get_ot_pay_context', {
    p_employee_id: employeeId,
    p_ot_date: otDate,
    p_planned_hours: plannedHours,
    p_rate_multiplier: mult,
    p_exclude_request_id: excludeRequestId ?? null,
  })

  if (!error && data && typeof data === 'object' && (data as OtPayContext).ok) {
    const ctx = data as OtPayContext
    month_hours = Number(ctx.month_hours ?? 0)
    month_amount = Number(ctx.month_amount ?? 0)
  } else if (error && !error.message.includes('Could not find the function')) {
    return { data: null, error: error.message }
  }

  const request_amount = local.data.request_amount
  return {
    data: {
      ok: true,
      basic: local.data.basic,
      currency: local.data.currency,
      hourly_rate: local.data.hourly_rate,
      request_amount,
      month_hours,
      month_amount,
      month_total_hours: month_hours + plannedHours,
      month_total_amount: month_amount + request_amount,
    },
    error: null,
  }
}

/** Load basic salary effective on a date, or latest record as fallback. */
export async function fetchEmployeeBasicPay(
  supabase: SupabaseClient,
  employeeId: string,
  asOfDate: string
): Promise<{ data: EmployeeBasicPay | null; error: string | null }> {
  const selectCols = 'basic, currency, effective_from, effective_to'

  const { data: dated, error: datedErr } = await supabase
    .from('employee_salary_history')
    .select(selectCols)
    .eq('employee_id', employeeId)
    .lte('effective_from', asOfDate)
    .order('effective_from', { ascending: false })
    .limit(20)

  if (datedErr) {
    return { data: null, error: datedErr.message }
  }

  const asOf = asOfDate.slice(0, 10)
  const active =
    (dated ?? []).find((row) => {
      const to = row.effective_to as string | null
      return !to || to.slice(0, 10) >= asOf
    }) ?? null

  if (active) {
    return {
      data: { basic: Number(active.basic ?? 0), currency: String(active.currency ?? 'PKR') },
      error: null,
    }
  }

  const { data: latest, error: latestErr } = await supabase
    .from('employee_salary_history')
    .select(selectCols)
    .eq('employee_id', employeeId)
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (latestErr) {
    return { data: null, error: latestErr.message }
  }

  if (!latest) {
    return { data: null, error: null }
  }

  return {
    data: { basic: Number(latest.basic ?? 0), currency: String(latest.currency ?? 'PKR') },
    error: null,
  }
}

/** Standard hours per day (matches payroll OT spreadsheet). */
export const DAILY_WORKING_HOURS = 8

/** Calendar days in the month of the OT date (e.g. June → 30). */
export function calendarDaysInMonth(isoDate: string): number {
  const [y, m] = isoDate.slice(0, 10).split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

/** Month denominator: month days × daily working hours (e.g. 30 × 8 = 240). */
export function monthlyWorkingHoursForDate(isoDate: string, dailyHours = DAILY_WORKING_HOURS): number {
  return calendarDaysInMonth(isoDate) * dailyHours
}

/** Hourly rate = basic salary ÷ (month days × hours per day). */
export function hourlyRateFromBasic(basic: number, otDate: string, dailyHours = DAILY_WORKING_HOURS): number {
  if (!basic || basic <= 0) return 0
  const monthHours = monthlyWorkingHoursForDate(otDate, dailyHours)
  if (monthHours <= 0) return 0
  return Math.round((basic / monthHours) * 100) / 100
}

/** Human-readable formula for UI (e.g. 400,000 ÷ (30 × 8) × 3.33 h). */
export function overtimePayFormulaLabel(isoDate: string, dailyHours = DAILY_WORKING_HOURS): string {
  const days = calendarDaysInMonth(isoDate)
  return `basic ÷ (${days} days × ${dailyHours} h) × OT hours × multiplier`
}

export function overtimePayAmount(hours: number, hourlyRate: number, multiplier: number): number {
  if (hours <= 0 || hourlyRate <= 0 || multiplier <= 0) return 0
  return Math.round(hours * hourlyRate * multiplier * 100) / 100
}

export function formatPkr(amount: number, currency = 'PKR'): string {
  return `${currency} ${Number(amount).toLocaleString('en-PK', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`
}

export function monthBoundsFromDate(isoDate: string): { start: string; end: string } {
  const [y, m] = isoDate.split('-').map(Number)
  const start = `${y}-${String(m).padStart(2, '0')}-01`
  const lastDay = new Date(y, m, 0).getDate()
  const end = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  return { start, end }
}
