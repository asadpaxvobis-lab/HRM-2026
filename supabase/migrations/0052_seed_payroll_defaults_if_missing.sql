-- Re-seed payroll components and tax slabs when missing (e.g. after data reset).

INSERT INTO public.payroll_components (
  company_id, code, name, component_type, calc_method, calc_value,
  is_taxable, is_eobi_applicable, is_pf_applicable, is_system, is_active, sort_order
)
SELECT
  c.id, v.code, v.name, v.ctype, v.method, v.val,
  v.taxable, v.eobi, v.pf, true, true, v.so
FROM public.companies c
CROSS JOIN (VALUES
  ('BASIC',        'Basic salary',                'EARNING',         'FIXED',     0,    true,  true,  true,  10),
  ('HRA',          'House rent allowance',        'EARNING',         'FIXED',     0,    true,  false, false, 20),
  ('MED',          'Medical allowance',           'EARNING',         'FIXED',     0,    false, false, false, 30),
  ('CONV',         'Conveyance allowance',        'EARNING',         'FIXED',     0,    true,  false, false, 40),
  ('UTIL',         'Utilities allowance',         'EARNING',         'FIXED',     0,    true,  false, false, 50),
  ('OTH',          'Other allowances / incentive','EARNING',         'FIXED',     0,    true,  false, false, 60),
  ('OT',           'Overtime',                    'EARNING',         'FIXED',     0,    true,  false, false, 70),
  ('BONUS',        'Bonus / commission',          'EARNING',         'FIXED',     0,    true,  false, false, 80),
  ('LOP',          'Loss of pay (unpaid leave)',  'DEDUCTION',       'FIXED',     0,    false, false, false, 100),
  ('TAX',          'Income tax (PAYE)',           'DEDUCTION',       'FORMULA',   0,    false, false, false, 110),
  ('EOBI_E',       'EOBI employee contribution',  'DEDUCTION',       'FIXED',     370,  false, false, false, 120),
  ('PF_E',         'Provident fund (employee)',   'DEDUCTION',       'PCT_BASIC', 8.33, false, false, false, 130),
  ('ADV',          'Salary advance recovery',     'DEDUCTION',       'FIXED',     0,    false, false, false, 140),
  ('EOBI_R',       'EOBI employer contribution',  'EMPLOYER_CONTRIB','FIXED',     1500, false, false, false, 200),
  ('PF_R',         'Provident fund (employer)',   'EMPLOYER_CONTRIB','PCT_BASIC', 8.33, false, false, false, 210)
) AS v(code, name, ctype, method, val, taxable, eobi, pf, so)
WHERE NOT EXISTS (
  SELECT 1 FROM public.payroll_components pc
  WHERE pc.company_id = c.id AND pc.code = v.code
);

INSERT INTO public.tax_slabs (company_id, fy_label, applies_to, slab_from, slab_to, base_tax, rate_pct, sort_order)
SELECT
  c.id, '2025-26', 'SALARIED', v.slab_from, v.slab_to, v.base_tax, v.rate_pct, v.so
FROM public.companies c
CROSS JOIN (VALUES
  (0,         600000,   0,        0,    10),
  (600000,    1200000,  0,        1,    20),
  (1200000,   2200000,  6000,     11,   30),
  (2200000,   3200000,  116000,   23,   40),
  (3200000,   4100000,  346000,   30,   50),
  (4100000,   NULL,     616000,   35,   60)
) AS v(slab_from, slab_to, base_tax, rate_pct, so)
WHERE NOT EXISTS (
  SELECT 1 FROM public.tax_slabs ts
  WHERE ts.company_id = c.id AND ts.fy_label = '2025-26' AND ts.applies_to = 'SALARIED'
);
