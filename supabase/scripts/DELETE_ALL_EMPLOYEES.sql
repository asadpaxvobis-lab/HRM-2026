-- =============================================================================
-- DANGER: Permanently deletes ALL rows from public.employees
-- and dependent HR records (attendance, leave, payroll slips, loans, etc.).
--
-- KEEPS: companies, branches, departments, designations, shifts, holidays,
--        users (login accounts), roles, permissions, letter templates, devices.
--
-- Run in Supabase Dashboard → SQL Editor (service role / postgres).
-- Take a backup first: Project Settings → Database → Backups
-- =============================================================================

BEGIN;

-- 1) Unlink login users from employees (users table stays)
UPDATE public.users
SET employee_id = NULL
WHERE employee_id IS NOT NULL;

-- 2) Recruitment hires → clear employee link
UPDATE public.candidates
SET employee_id = NULL
WHERE employee_id IS NOT NULL;

-- 3) Clear self-references on employees
UPDATE public.employees
SET reports_to_id = NULL
WHERE reports_to_id IS NOT NULL;

-- 4) Tables with ON DELETE RESTRICT (delete children first)
DELETE FROM public.expense_claim_lines;
DELETE FROM public.expense_claims;

DELETE FROM public.payslip_lines;
DELETE FROM public.payslips;

DELETE FROM public.loan_installments;
DELETE FROM public.loans;

DELETE FROM public.overtime_requests;

DELETE FROM public.letters;

DELETE FROM public.resignation_clearance_steps;
DELETE FROM public.resignations;

-- 5) Delete all employees (CASCADE removes attendance, leave, documents, salary, pins, etc.)
DELETE FROM public.employees;

COMMIT;

-- Verify
SELECT 'employees remaining' AS check, count(*)::bigint AS n FROM public.employees;
