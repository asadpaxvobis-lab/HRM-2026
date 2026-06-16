-- Restore attendance.device permission (required for Admin → Devices → Add device).
-- Run in SQL Editor if the Add device button is missing after a data reset.

INSERT INTO public.permissions (module, action, description, is_system)
SELECT 'attendance', 'device', 'Manage attendance devices', true
WHERE NOT EXISTS (SELECT 1 FROM public.permissions WHERE module = 'attendance' AND action = 'device');

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'Super Admin'
  AND p.code = 'attendance.device'
  AND NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'HR Admin'
  AND p.code = 'attendance.device'
  AND NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
