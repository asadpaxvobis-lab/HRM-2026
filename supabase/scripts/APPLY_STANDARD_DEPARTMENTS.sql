-- Run in Supabase SQL Editor AFTER migration 0037_apply_standard_departments.sql
-- Or run: SELECT public.apply_standard_departments();  (as authenticated admin)

-- === Option A: RPC (preferred, uses your logged-in company) ===
-- SELECT public.apply_standard_departments();

-- === Option B: Manual block for default company ===
DO $$
DECLARE
  v_company uuid := '00000000-0000-0000-0000-000000000001';
  rec record;
  v_id uuid;
  names text[] := ARRAY[
    'Accounts Dept', 'ADMIN', 'C-Suite', 'DESIGNING', 'Designs Dept',
    'EMBROIDERY', 'Main Godown', 'Online Dept', 'PACKING'
  ];
  i int;
  v_code text;
BEGIN
  FOR i IN 1 .. array_length(names, 1) LOOP
    v_code := 'DEPT-' || lpad(i::text, 3, '0');

    SELECT d.id INTO v_id
    FROM public.departments d
    WHERE d.company_id = v_company
      AND lower(regexp_replace(trim(d.name), '\s+', ' ', 'g')) =
          lower(regexp_replace(trim(names[i]), '\s+', ' ', 'g'))
    LIMIT 1;

    IF v_id IS NULL THEN
      SELECT d.id INTO v_id
      FROM public.departments d
      WHERE d.company_id = v_company
        AND (
          lower(d.name) LIKE '%' || lower(split_part(names[i], ' ', 1)) || '%'
          OR lower(names[i]) LIKE '%' || lower(split_part(d.name, ' ', 1)) || '%'
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.departments x
          WHERE x.company_id = v_company AND x.code = v_code
        )
      ORDER BY d.created_at
      LIMIT 1;
    END IF;

    IF v_id IS NOT NULL THEN
      UPDATE public.departments
      SET code = v_code, name = names[i], is_active = true, updated_at = now()
      WHERE id = v_id;
    ELSE
      INSERT INTO public.departments (company_id, code, name, is_active)
      VALUES (v_company, v_code, names[i], true);
    END IF;
  END LOOP;

  i := array_length(names, 1) + 1;
  FOR rec IN
    SELECT d.id, d.code, d.name
    FROM public.departments d
    WHERE d.company_id = v_company
      AND d.code !~ '^DEPT-00[1-9]$'
    ORDER BY d.created_at
  LOOP
    v_code := 'DEPT-' || lpad(i::text, 3, '0');
    WHILE EXISTS (
      SELECT 1 FROM public.departments x
      WHERE x.company_id = v_company AND x.code = v_code AND x.id <> rec.id
    ) LOOP
      i := i + 1;
      v_code := 'DEPT-' || lpad(i::text, 3, '0');
    END LOOP;
    UPDATE public.departments SET code = v_code, updated_at = now() WHERE id = rec.id;
    i := i + 1;
  END LOOP;
END $$;

SELECT code, name FROM public.departments
WHERE company_id = '00000000-0000-0000-0000-000000000001'
ORDER BY code;
