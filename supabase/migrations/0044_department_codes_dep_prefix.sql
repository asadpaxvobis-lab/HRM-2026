-- Standard department codes use DEP-001 … DEP-009 (not DEPT-).
-- Safe renumber: temp codes first, then final DEP- codes.

CREATE OR REPLACE FUNCTION public.apply_standard_departments()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company uuid;
  names text[] := ARRAY[
    'Accounts Dept', 'ADMIN', 'C-Suite', 'DESIGNING', 'Designs Dept',
    'EMBROIDERY', 'Main Godown', 'Online Dept', 'PACKING'
  ];
  i int;
  v_code text;
  v_id uuid;
  v_created int := 0;
  v_updated int := 0;
  rec record;
BEGIN
  IF NOT (
    public.user_has_permission('department.create')
    OR public.user_has_permission('department.update')
  ) THEN
    RAISE EXCEPTION 'Permission denied: department.create or department.update required';
  END IF;

  v_company := public.current_user_company_id();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No company linked to current user';
  END IF;

  UPDATE public.departments d
  SET code = 'TMP-' || substr(d.id::text, 1, 8), updated_at = now()
  WHERE d.company_id = v_company;

  FOR i IN 1 .. array_length(names, 1) LOOP
    v_code := 'DEP-' || lpad(i::text, 3, '0');
    v_id := NULL;

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
        AND lower(d.name) LIKE '%' || lower(split_part(names[i], ' ', 1)) || '%'
      ORDER BY d.created_at
      LIMIT 1;
    END IF;

    IF v_id IS NOT NULL THEN
      UPDATE public.departments
      SET code = v_code, name = names[i], is_active = true, updated_at = now()
      WHERE id = v_id;
      v_updated := v_updated + 1;
    ELSE
      INSERT INTO public.departments (company_id, code, name, is_active)
      VALUES (v_company, v_code, names[i], true);
      v_created := v_created + 1;
    END IF;
  END LOOP;

  i := array_length(names, 1) + 1;
  FOR rec IN
    SELECT d.id, d.code
    FROM public.departments d
    WHERE d.company_id = v_company
      AND d.code LIKE 'TMP-%'
    ORDER BY d.created_at
  LOOP
    v_code := 'DEP-' || lpad(i::text, 3, '0');
    WHILE EXISTS (
      SELECT 1 FROM public.departments x
      WHERE x.company_id = v_company AND x.code = v_code AND x.id <> rec.id
    ) LOOP
      i := i + 1;
      v_code := 'DEP-' || lpad(i::text, 3, '0');
    END LOOP;
    UPDATE public.departments SET code = v_code, updated_at = now() WHERE id = rec.id;
    v_updated := v_updated + 1;
    i := i + 1;
  END LOOP;

  RETURN jsonb_build_object('created', v_created, 'updated', v_updated);
END;
$$;

COMMENT ON FUNCTION public.apply_standard_departments IS
  'Upsert 9 standard departments with codes DEP-001 … DEP-009 for current user company';
