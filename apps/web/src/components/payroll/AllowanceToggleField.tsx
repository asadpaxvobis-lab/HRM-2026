import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Props = {
  label: string
  enabled: boolean
  amount: number
  onEnabledChange: (v: boolean) => void
  onAmountChange: (v: number) => void
  disabled?: boolean
}

export function AllowanceToggleField({
  label,
  enabled,
  amount,
  onEnabledChange,
  onAmountChange,
  disabled,
}: Props) {
  return (
    <div className="rounded-lg border p-3 space-y-2">
      <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
        <Checkbox checked={enabled} onCheckedChange={(v) => onEnabledChange(v === true)} disabled={disabled} />
        {label}
      </label>
      {enabled && (
        <div className="pl-6 space-y-1">
          <Label className="text-xs text-muted-foreground">Amount (PKR)</Label>
          <Input
            type="number"
            min={0}
            step={1}
            value={amount}
            onChange={(e) => onAmountChange(+e.target.value || 0)}
            disabled={disabled}
            required
          />
        </div>
      )}
    </div>
  )
}

export type AllowanceFormFlags = {
  house_rent_enabled: boolean
  medical_enabled: boolean
  conveyance_enabled: boolean
  utilities_enabled: boolean
  other_allowances_enabled: boolean
}

export const defaultAllowanceFlags = (): AllowanceFormFlags => ({
  house_rent_enabled: false,
  medical_enabled: false,
  conveyance_enabled: false,
  utilities_enabled: false,
  other_allowances_enabled: false,
})

export function compGrossFromForm(
  basic: number,
  comp: {
    house_rent: number
    medical: number
    conveyance: number
    utilities: number
    other_allowances: number
  } & AllowanceFormFlags
): number {
  return (
    +basic +
    (comp.house_rent_enabled ? +comp.house_rent : 0) +
    (comp.medical_enabled ? +comp.medical : 0) +
    (comp.conveyance_enabled ? +comp.conveyance : 0) +
    (comp.utilities_enabled ? +comp.utilities : 0) +
    (comp.other_allowances_enabled ? +comp.other_allowances : 0)
  )
}

export function validateAllowanceForm(
  comp: {
    house_rent: number
    medical: number
    conveyance: number
    utilities: number
    other_allowances: number
  } & AllowanceFormFlags
): string | null {
  const checks: [boolean, number, string][] = [
    [comp.house_rent_enabled, comp.house_rent, 'House rent'],
    [comp.medical_enabled, comp.medical, 'Medical allowance'],
    [comp.conveyance_enabled, comp.conveyance, 'Conveyance allowance'],
    [comp.utilities_enabled, comp.utilities, 'Utilities allowance'],
    [comp.other_allowances_enabled, comp.other_allowances, 'Other allowances / incentive'],
  ]
  for (const [on, amt, name] of checks) {
    if (on && amt <= 0) return `${name} amount is required when enabled`
  }
  return null
}
