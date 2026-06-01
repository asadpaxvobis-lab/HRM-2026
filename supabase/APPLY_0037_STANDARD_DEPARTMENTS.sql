-- Paste into Supabase SQL Editor and run once.

\ir migrations/0037_apply_standard_departments.sql

-- If \ir is not supported, paste contents of migrations/0037_apply_standard_departments.sql instead.

SELECT public.apply_standard_departments() AS result;

SELECT code, name FROM public.departments
WHERE company_id = public.current_user_company_id()
   OR company_id = '00000000-0000-0000-0000-000000000001'
ORDER BY code;
