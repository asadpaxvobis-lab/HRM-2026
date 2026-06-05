-- Per-allowance enable flags on compensation (control payslip line visibility).

ALTER TABLE public.employee_salary_history
  ADD COLUMN IF NOT EXISTS house_rent_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS medical_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS conveyance_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS utilities_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS other_allowances_enabled boolean NOT NULL DEFAULT false;

UPDATE public.employee_salary_history SET house_rent_enabled = true WHERE house_rent > 0;
UPDATE public.employee_salary_history SET medical_enabled = true WHERE medical > 0;
UPDATE public.employee_salary_history SET conveyance_enabled = true WHERE conveyance > 0;
UPDATE public.employee_salary_history SET utilities_enabled = true WHERE utilities > 0;
UPDATE public.employee_salary_history SET other_allowances_enabled = true WHERE other_allowances > 0;
