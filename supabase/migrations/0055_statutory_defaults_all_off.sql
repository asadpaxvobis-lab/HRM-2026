-- Statutory enrollment: all deductions off by default (opt-in per employee).
ALTER TABLE public.employee_statutory_enrollment
  ALTER COLUMN income_tax_enabled SET DEFAULT false;
