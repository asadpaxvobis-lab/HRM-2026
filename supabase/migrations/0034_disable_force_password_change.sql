-- Stop forcing change-password screen; clear stuck flags on existing users.

UPDATE public.users
SET force_password_change = false, updated_at = now()
WHERE force_password_change = true;

UPDATE auth.users
SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || '{"force_password_change": false}'::jsonb,
    updated_at = now()
WHERE COALESCE(raw_user_meta_data->>'force_password_change', 'false') = 'true';

CREATE OR REPLACE FUNCTION public.admin_create_user(
  p_email text,
  p_password text,
  p_full_name text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_role_ids uuid[] DEFAULT '{}'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_user_id uuid := gen_random_uuid();
  v_company_id uuid;
  v_role_id uuid;
  v_email text := lower(trim(p_email));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.user_has_permission('user.create') THEN
    RAISE EXCEPTION 'user.create permission required';
  END IF;

  v_company_id := public.current_user_company_id();
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Company not found for current user';
  END IF;

  IF v_email IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'Email is required';
  END IF;

  IF p_password IS NULL OR length(p_password) < 6 THEN
    RAISE EXCEPTION 'Password must be at least 6 characters';
  END IF;

  IF EXISTS (SELECT 1 FROM public.users WHERE email = v_email) THEN
    RAISE EXCEPTION 'A user with this email already exists';
  END IF;

  IF EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = v_email) THEN
    RAISE EXCEPTION 'A login account with this email already exists';
  END IF;

  INSERT INTO auth.users (
    instance_id, id, aud, role, email,
    encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    v_user_id,
    'authenticated',
    'authenticated',
    v_email,
    crypt(p_password, gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object(
      'full_name', NULLIF(trim(p_full_name), ''),
      'force_password_change', false
    ),
    now(), now(),
    '', '', '', ''
  );

  INSERT INTO auth.identities (
    id, user_id, identity_data, provider, provider_id,
    last_sign_in_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid(),
    v_user_id,
    jsonb_build_object('sub', v_user_id::text, 'email', v_email, 'email_verified', true),
    'email',
    v_user_id::text,
    now(), now(), now()
  );

  INSERT INTO public.users (
    id, company_id, email, full_name, phone, status, force_password_change, created_by
  ) VALUES (
    v_user_id,
    v_company_id,
    v_email,
    NULLIF(trim(p_full_name), ''),
    NULLIF(trim(p_phone), ''),
    'Active',
    false,
    auth.uid()
  );

  IF p_role_ids IS NOT NULL THEN
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
      VALUES (v_user_id, v_role_id, auth.uid())
      ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;

  RETURN v_user_id;
END;
$$;
