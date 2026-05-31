-- Admin edit user profile/roles and set a new login password.

CREATE OR REPLACE FUNCTION public.admin_update_user(
  p_user_id uuid,
  p_full_name text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_role_ids uuid[] DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
  v_role_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.user_has_permission('user.update') THEN
    RAISE EXCEPTION 'user.update permission required';
  END IF;

  v_company_id := public.current_user_company_id();
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Company not found for current user';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_user_id AND u.company_id = v_company_id
  ) THEN
    RAISE EXCEPTION 'User not found in your company';
  END IF;

  IF p_status IS NOT NULL AND p_status NOT IN ('Active', 'Disabled', 'Pending') THEN
    RAISE EXCEPTION 'Invalid status';
  END IF;

  IF p_user_id = auth.uid() AND p_status IS NOT NULL AND p_status <> 'Active' THEN
    RAISE EXCEPTION 'You cannot disable your own account';
  END IF;

  UPDATE public.users
  SET
    full_name = CASE WHEN p_full_name IS NOT NULL THEN NULLIF(trim(p_full_name), '') ELSE full_name END,
    phone = CASE WHEN p_phone IS NOT NULL THEN NULLIF(trim(p_phone), '') ELSE phone END,
    status = COALESCE(p_status, status),
    updated_at = now()
  WHERE id = p_user_id;

  IF p_role_ids IS NOT NULL THEN
    IF p_user_id = auth.uid() THEN
      RAISE EXCEPTION 'You cannot change your own roles';
    END IF;

    DELETE FROM public.user_roles WHERE user_id = p_user_id;

    FOREACH v_role_id IN ARRAY p_role_ids LOOP
      IF v_role_id IS NULL THEN
        CONTINUE;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.roles r
        WHERE r.id = v_role_id AND r.company_id = v_company_id
      ) THEN
        RAISE EXCEPTION 'Invalid role for this company';
      END IF;
      INSERT INTO public.user_roles (user_id, role_id, assigned_by)
      VALUES (p_user_id, v_role_id, auth.uid())
      ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_reset_user_password(
  p_user_id uuid,
  p_password text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_company_id uuid;
  v_email text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.user_has_permission('user.reset_password') THEN
    RAISE EXCEPTION 'user.reset_password permission required';
  END IF;

  IF p_password IS NULL OR length(p_password) < 6 THEN
    RAISE EXCEPTION 'Password must be at least 6 characters';
  END IF;

  v_company_id := public.current_user_company_id();
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Company not found for current user';
  END IF;

  SELECT u.email INTO v_email
  FROM public.users u
  WHERE u.id = p_user_id AND u.company_id = v_company_id;

  IF v_email IS NULL THEN
    RAISE EXCEPTION 'User not found in your company';
  END IF;

  UPDATE auth.users
  SET
    encrypted_password = crypt(p_password, gen_salt('bf')),
    updated_at = now(),
    raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb)
      || jsonb_build_object('force_password_change', true)
  WHERE id = p_user_id;

  UPDATE public.users
  SET force_password_change = true, updated_at = now()
  WHERE id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_user(uuid, text, text, text, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_user_password(uuid, text) TO authenticated;

-- Password reset is Super Admin only (system administrator).
DELETE FROM public.role_permissions rp
USING public.permissions p, public.roles r
WHERE rp.permission_id = p.id
  AND rp.role_id = r.id
  AND p.code = 'user.reset_password'
  AND r.name <> 'Super Admin';

-- Password reset is Super Admin only (system administrator).
DELETE FROM public.role_permissions rp
USING public.permissions p, public.roles r
WHERE rp.permission_id = p.id
  AND rp.role_id = r.id
  AND p.code = 'user.reset_password'
  AND r.name <> 'Super Admin';
