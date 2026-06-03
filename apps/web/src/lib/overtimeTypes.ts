export type OtTypeCode = 'NORMAL' | 'WEEKEND' | 'HOLIDAY' | 'NIGHT'

export const OT_TYPE_OPTIONS: { value: OtTypeCode; label: string; multiplier: number }[] = [
  { value: 'NORMAL', label: 'Normal weekday', multiplier: 1.0 },
  { value: 'WEEKEND', label: 'Weekend', multiplier: 2.0 },
  { value: 'HOLIDAY', label: 'Public holiday', multiplier: 2.5 },
  { value: 'NIGHT', label: 'Night shift', multiplier: 2.0 },
]

export function defaultMultiplierForType(otType: string): number {
  return OT_TYPE_OPTIONS.find((x) => x.value === otType)?.multiplier ?? 1.0
}
