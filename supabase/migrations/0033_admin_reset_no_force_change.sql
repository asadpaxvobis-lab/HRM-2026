-- Admin password reset should not force change-password on next login.

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
  v_auth_rows integer;
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

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Login account not found for this user';
  END IF;

  UPDATE auth.users
  SET
    encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
    updated_at = now(),
    confirmation_token = '',
    recovery_token = '',
    email_change_token_new = '',
    raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb)
      || jsonb_build_object('force_password_change', false)
  WHERE id = p_user_id;

  GET DIAGNOSTICS v_auth_rows = ROW_COUNT;
  IF v_auth_rows = 0 THEN
    RAISE EXCEPTION 'Could not update login password';
  END IF;

  UPDATE public.users
  SET force_password_change = false, updated_at = now()
  WHERE id = p_user_id;
END;
$$;
