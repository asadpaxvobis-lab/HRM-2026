# Phase 1 - Foundation: Status

## What is built

### Database (Supabase project `composer-hrm` / `zxkkmwycimijvbpgqpfh`)
- All 40 legacy tables dropped
- 17 fresh tables created with RLS enabled on every one
- 90 permissions seeded across all upcoming modules
- 7 built-in roles seeded (Super Admin, HR Admin, HR Officer, Payroll Officer, Department Manager, Branch Manager, Employee) with 291 role-permission mappings
- Default company `My Company (Pvt) Ltd` (PKR, Asia/Karachi, fiscal year starts July)
- App settings row with default Industry-4.0 config
- Helper functions: `current_user_company_id()`, `user_has_permission(code)`

### Auth
- Admin user seeded: `admin@hrm.com` / `admin123`
- `force_password_change = true` so on first login you must set a new password
- Linked to Super Admin role with all 90 permissions

### Web app (`apps/web`)
- React 18 + Vite + TypeScript + Tailwind + shadcn primitives
- Warm-orange minimalist theme, light + dark + system mode (`next-themes` style class strategy)
- Inter font + JetBrains Mono for codes
- Auth context wired to Supabase Auth + RLS-aware profile loading
- Protected routes with permission gates
- Force-password-change redirect flow
- Pages:
  - `/login` - branded two-column layout
  - `/change-password` - mandatory after first login
  - `/` - dashboard with live counts
  - `/admin/users` - user CRUD with role assignment, status toggle, force pwd reset
  - `/admin/roles` - role list + permission grid editor (group-toggle, search, dirty-state save)
  - `/admin/settings` - payroll / security toggles
  - `/admin/audit` - audit log viewer
  - Placeholder pages for Phase 2-10 routes

### Database schema (Phase 1)

| Module | Tables |
|--------|--------|
| Org    | companies, branches, departments, designations, employees (skeleton) |
| Identity | users, user_invitations, login_attempts |
| RBAC | permissions (90), roles (7), role_permissions (291), user_roles, user_permission_overrides |
| Security | user_2fa, allowed_ip_ranges |
| Audit | audit_logs |
| Settings | app_settings |

## How to run

```powershell
cd "d:\hrm complete\apps\web"
npm install
npm run dev
```

Open http://localhost:5173 and log in with `admin@hrm.com` / `admin123`.

The first thing you'll see is the change-password screen because the seeded admin has `force_password_change = true`. Once you set a new password you'll land on the dashboard.

## What is intentionally NOT in Phase 1

- ASP.NET Core API skeleton (web speaks to Supabase directly for Phase 1; the .NET API will come in the next batch as the backend for business logic, ZKTeco webhook, SignalR hub, and Quartz jobs)
- Email-based user invitation flow (relies on a service-role endpoint or Edge Function; for now create-user uses signUp which lands the new user in a pending email-confirm state on hosted Supabase, OR you can lower Auth's email-confirm setting in the dashboard)
- 2FA enrollment screen (table is ready; Supabase Auth MFA enrol flow ships in next batch)
- IP range editor screen (table is ready; CRUD screen ships in next batch)
- Audit log writer (table + viewer ready; writer hooks ship with the .NET API + Edge Function)

## Next batch (still inside Phase 1 wrap-up)

1. ASP.NET Core 8 Web API scaffold with Supabase JWT validation, `[Permission(...)]` attribute + auto-discovery + audit middleware
2. Email-confirm bypass via service-role Edge Function for admin-created users
3. 2FA enroll/verify screen
4. IP range editor screen
5. Audit writer wired to web mutations

## Phase 2 progress (resumed)

### Master data (live in web app)
- **Branches** — `/branches` — CRUD with weekly off days, shift times, province, geofence
- **Departments** — `/departments` — CRUD with optional parent department
- **Designations** — `/designations` — CRUD with grade
- **Employees** — `/employees` — list, search, create/edit with branch/dept/designation/reports-to

### Phase 1 wrap-up (resumed)
- **Audit logging** — `writeAuditLog()` on settings save, user enable/disable, master data CRUD; DB policy `audit_insert` applied
- **IP ranges** — Settings → Allowed IP ranges section (add/remove CIDR)
- **create-user Edge Function** — `supabase/functions/create-user` (deploy to skip email confirm); Users page tries Edge Function first, falls back to `signUp`
- **.NET API skeleton** — `apps/api` (requires .NET 8 SDK): health + `/api/me`, JWT config placeholder, `[Permission]` attribute

## Phase 2 progress (continued)

### Database
- `0005_holidays_shifts_statutory` — `holidays`, `branch_holiday_exclusions`, `shifts`, `employee_statutory_enrollment` + RLS
- `0006_seed_pk_holidays_shifts` — 13 Pakistan 2026 holidays + 3 default shifts (GEN, FACT, NIGHT)

### Web (new routes)
- `/holidays` — holiday calendar CRUD (year filter, branch-specific optional)
- `/shifts` — shift template CRUD
- `/employees/:id` — employee profile + **Statutory** tab (EOBI, PF, Social Security, Income Tax toggles)
- **Settings** — company profile section (name, legal name, NTN, address, contact)
- Employees list — chevron opens detail page

## Phase 2 batch 2 (this resume)

### Database
- `0007_shifts_compensation_documents` — `employee_shift_assignments`, `employee_salary_history`, `employee_documents` + RLS
- `0008_employee_documents_storage_bucket` — private `employee-documents` Storage bucket + RLS policies on `storage.objects`

### Web
- **Holidays page** — branch exclusions dialog (per company-wide holiday); excluded-branch count badge
- **EmployeeDetail tabs** — Profile, Statutory, **Shifts**, **Compensation**, **Documents**
  - Shifts: effective-dated assignments with weekly-off chips and history
  - Compensation: salary breakdown (basic / HRA / medical / conveyance / utilities / other), pay frequency, revision history, audit trail
  - Documents: upload to private bucket, signed-URL download, expiry & “expires soon” badges
- New `Textarea` UI primitive
- Constants: `PAY_FREQUENCIES`, `WEEKDAY_NAMES`, `DOC_TYPES`

## Phase 2 batch 3 — wrap-up

### Web
- **Holidays CSV import / export / template** (Excel opens UTF-8 BOM CSV natively; no extra dependency)
- **Roster** page at `/roster` — full employee grid with current shift, weekly-off chips, search + branch/department filters and **bulk shift assignment**
- New `src/lib/csv.ts` (zero-dep CSV parser + downloader)

## Phase 3 — Attendance core (started this resume)

### Database — applied as `0009_attendance_core`
- `attendance_devices` — ZKTeco / Face Kiosk / Mobile / Manual; per-branch
- `attendance_punches` — raw events with source (zkteco / face_kiosk / mobile / manual / import), optional GPS, raw_payload JSON
- `attendance_daily` — per-employee per-day aggregate (first_in / last_out / worked / late / early_out / overtime / status)
- `attendance_corrections` — request → approve workflow
- New permission `attendance.device`; granted to Super Admin
- RLS uses existing `attendance.view / create / update / approve` codes

### Web
- `/attendance` page replaces placeholder:
  - Date picker + branch + department + name filters
  - Status tiles (Present / Late / Absent / Leave / Weekly Off / Holiday / Half Day)
  - Per-employee row with shift, in/out, worked, late, OT
  - **Manual punch** dialog (audit-logged; auto-recompute after save)
  - **Re-aggregate** button to rebuild `attendance_daily` for the selected day
  - **Export CSV** of the day
- `src/lib/attendance.ts` — client-side aggregator using each employee’s effective shift + holidays + weekly off (will be replaced by a PG function or .NET worker later for scale)

## Phase 3 batch 2 — devices + corrections

### Web
- **`/admin/devices`** — register / edit / disable / delete ZKTeco / Face Kiosk / Mobile / Manual devices; per-branch; copy-able push token (used by the future .NET ingest endpoint); last-seen badge with auto Online / minutes / hours / days
- **`/attendance/corrections`** — request + approve workflow
  - Anyone with `attendance.view` can request (employee, date, proposed in/out, reason)
  - Approvers with `attendance.approve` can approve / reject
  - **Approve** inserts the proposed `in` / `out` punches and re-aggregates the day automatically
- Sidebar: new **Corrections** link under Time, new **Devices** link under Administration

### Phase 3 batch 3 — server aggregation + live feed (done)
- **Postgres** — `recompute_attendance_for_employee`, punch trigger, `device_pin` on employees (`0024`+)
- **Edge Function** — `zkteco-push` webhook (device push token from `/admin/devices`)
- **Dashboard** — Supabase Realtime subscription on `attendance_punches` for live punch feed
- **Overtime** — net OT excludes late minutes (`0028_overtime_exclude_late`)
- **Manual edit** — `set_manual_attendance_day` RPC (`0029`) syncs manual punches + recompute so Re-aggregate does not wipe edited in/out

### Phase 3 optional / later
- Full SignalR hub (.NET) instead of Supabase Realtime only
- Edge Functions deployed: `zkteco-push` (JWT off, push-token auth) and `create-user` (admin user creation without email confirm)

## Profile (placeholder replaced)
- `/profile` — name update, change password, permission summary by module

## Phase 4 — Leave management (delivered)

### Database — `0010_leave_core`
- `leave_types` — 8 default Pakistan types seeded (Annual, Casual, Sick, Maternity, Paternity, Hajj, Unpaid, Bereavement)
- `leave_balances` — per employee × leave-type × year (opening/granted/consumed/carry-forward)
- `leave_applications` — Pending → Approved/Rejected/Cancelled workflow with audit
- RLS uses existing `leave.view / apply / approve / config` permissions

### Web
- `/leave` — three-tab page:
  - **Apply** — pick leave type, dates, half-day, reason; sidebar shows real-time remaining balance per type for the user's employee record
  - **My requests** — own request history with cancel for pending ones
  - **All requests** — global queue with status filter; approvers see Approve / Reject buttons
- `/leave/balances` — admin balances grid with **Bulk grant {year}** (skips employees who already have a granted balance for the year, respects gender filters); inline edit per employee × type
- `/leave/types` — leave type CRUD with paid/unpaid, default days, carry-forward, attachment requirement, half-day flag, gender filter, color
- **Approve** automatically increments `leave_balances.consumed` by the requested days
- Sidebar: **Leave · Leave balances · Leave types** (last hidden without `leave.config`)

## Phase 3 onwards

See README.md for the full 10-phase roadmap.
