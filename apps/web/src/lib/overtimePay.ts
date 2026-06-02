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

/** Preferred: server RPC (works for employees + admin). Falls back to direct salary read. */
export async function fetchOtPayContext(
  supabase: SupabaseClient,
  employeeId: string,
  otDate: string,
  plannedHours: number,
  rateMultiplier: number,
  excludeRequestId?: string | null
): Promise<{ data: OtPayContext | null; error: string | null }> {
  const { data, error } = await supabase.rpc('get_ot_pay_context', {
    p_employee_id: employeeId,
    p_ot_date: otDate,
    p_planned_hours: plannedHours,
    p_rate_multiplier: rateMultiplier,
    p_exclude_request_id: excludeRequestId ?? null,
  })

  if (!error && data && typeof data === 'object' && (data as OtPayContext).ok) {
    const ctx = data as OtPayContext
    return {
      data: {
        ok: true,
        basic: Number(ctx.basic ?? 0),
        currency: String(ctx.currency ?? 'PKR'),
        hourly_rate: Number(ctx.hourly_rate ?? 0),
        request_amount: Number(ctx.request_amount ?? 0),
        month_hours: Number(ctx.month_hours ?? 0),
        month_amount: Number(ctx.month_amount ?? 0),
        month_total_hours: Number(ctx.month_total_hours ?? 0),
        month_total_amount: Number(ctx.month_total_amount ?? 0),
      },
      error: null,
    }
  }

  if (error && !error.message.includes('Could not find the function')) {
    return { data: null, error: error.message }
  }

  const pay = await fetchEmployeeBasicPay(supabase, employeeId, otDate)
  if (pay.error) return { data: null, error: pay.error }
  if (!pay.data || pay.data.basic <= 0) return { data: null, error: null }

  const hourly_rate = hourlyRateFromBasic(pay.data.basic)
  const request_amount = overtimePayAmount(plannedHours, hourly_rate, rateMultiplier)

  return {
    data: {
      ok: true,
      basic: pay.data.basic,
      currency: pay.data.currency,
      hourly_rate,
      request_amount,
      month_hours: 0,
      month_amount: 0,
      month_total_hours: plannedHours,
      month_total_amount: request_amount,
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

/** Standard monthly working hours for hourly rate (26 days × 8 hours). */
export const MONTHLY_WORKING_HOURS = 26 * 8

export function hourlyRateFromBasic(basic: number): number {
  if (!basic || basic <= 0) return 0
  return Math.round((basic / MONTHLY_WORKING_HOURS) * 100) / 100
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
