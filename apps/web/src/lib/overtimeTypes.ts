import { supabase } from '@/lib/supabase'

export type OtTypeCode = 'NORMAL' | 'WEEKEND' | 'HOLIDAY' | 'NIGHT'

export const OT_TYPE_LABELS: Record<OtTypeCode, string> = {
  NORMAL: 'Normal weekday',
  WEEKEND: 'Weekend',
  HOLIDAY: 'Public holiday',
  NIGHT: 'Night shift',
}

export const DEFAULT_OT_MULTIPLIERS: Record<OtTypeCode, number> = {
  NORMAL: 1.0,
  WEEKEND: 2.0,
  HOLIDAY: 2.5,
  NIGHT: 2.0,
}

export type OtMultipliers = Record<OtTypeCode, number>

/** Built-in defaults (used before company settings load). */
export const OT_TYPE_OPTIONS: { value: OtTypeCode; label: string; multiplier: number }[] = (
  Object.keys(OT_TYPE_LABELS) as OtTypeCode[]
).map((value) => ({
  value,
  label: OT_TYPE_LABELS[value],
  multiplier: DEFAULT_OT_MULTIPLIERS[value],
}))

export function mergeOtMultipliers(partial?: Partial<OtMultipliers> | null): OtMultipliers {
  return { ...DEFAULT_OT_MULTIPLIERS, ...partial }
}

export function buildOtTypeOptions(multipliers?: Partial<OtMultipliers> | null) {
  const m = mergeOtMultipliers(multipliers)
  return (Object.keys(OT_TYPE_LABELS) as OtTypeCode[]).map((value) => ({
    value,
    label: OT_TYPE_LABELS[value],
    multiplier: m[value],
  }))
}

export function defaultMultiplierForType(
  otType: string,
  multipliers?: Partial<OtMultipliers> | null
): number {
  const m = mergeOtMultipliers(multipliers)
  return m[otType as OtTypeCode] ?? 1.0
}

/** Pick multiplier for a pending row — fixes stale ×1 on WEEKEND/HOLIDAY rows. */
export function multiplierForPendingRow(
  otType: OtTypeCode,
  stored: number | null | undefined,
  multipliers?: Partial<OtMultipliers> | null
): number {
  const expected = defaultMultiplierForType(otType, multipliers)
  const n = Number(stored)
  if (!Number.isFinite(n) || n <= 0) return expected
  if (otType !== 'NORMAL' && n === 1) return expected
  return n
}

export async function fetchOtMultipliers(companyId: string): Promise<OtMultipliers> {
  const { data } = await supabase
    .from('app_settings')
    .select('settings')
    .eq('company_id', companyId)
    .maybeSingle()

  const raw = (data?.settings as { ot_multipliers?: Partial<OtMultipliers> } | null)?.ot_multipliers
  return mergeOtMultipliers(raw)
}

export async function saveOtMultipliers(
  _companyId: string,
  multipliers: OtMultipliers
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('save_ot_multipliers', { p_multipliers: multipliers })
  return { error: error?.message ?? null }
}
