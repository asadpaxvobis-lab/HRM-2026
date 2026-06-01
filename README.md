# HRM ERP - Industry 4.0

Professional ERP HRM + Payroll system for Pakistan single-company multi-branch deployments.

## Stack

- **Web Admin**: React 18 + Vite + TypeScript + shadcn/ui + Tailwind (warm orange minimalist theme, light + dark mode)
- **API**: ASP.NET Core 8 + SignalR + EF Core (Npgsql)
- **Database**: Supabase Postgres 17 (RLS enabled on every table)
- **Auth**: Supabase Auth (JWT) verified by .NET API
- **Mobile** (later): React Native + Expo
- **Kiosk** (later): React PWA + face-api.js
- **ZKTeco Agent** (later): .NET 8 Worker Service

## Repository Layout

```
apps/
  web/         React + Vite admin portal
  api/         ASP.NET Core 8 Web API
  kiosk/       (Phase 7) Face kiosk PWA
  mobile/      (Phase 7) React Native Expo app
  agent/       (Phase 3) Windows worker for offline ZKTeco branches
supabase/
  migrations/  SQL migrations (idempotent, ordered)
  seed/        Optional seed scripts
packages/
  shared-types/  Shared TypeScript types
```

## Quick Start (Phase 1 - Foundation)

### Prerequisites
- Node.js 20+
- .NET 8 SDK
- Supabase project (currently `composer-hrm`, ref `zxkkmwycimijvbpgqpfh`)

### 1. Environment

Copy `.env.example` files in each app to `.env` and fill values:

```
apps/web/.env             -> VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_API_BASE_URL
apps/api/appsettings.json -> Supabase URL, JWT secret, service role key
```

### 2. Database

The Phase 1 migration drops the legacy 40-table schema from the previous attempt and rebuilds with RLS enabled from day one.

Run migrations via Supabase MCP or paste the SQL files into Supabase Dashboard -> SQL Editor in this order:

```
supabase/migrations/0001_init_auth_rbac.sql
supabase/migrations/0002_seed_permissions_roles.sql
supabase/migrations/0003_seed_admin_user.sql
```

### 3. Web app

```
cd apps/web
npm install
npm run dev
```

Open http://localhost:5173 and log in with:

- Email: `admin@hrm.com`
- Temp password: `admin123` (you will be forced to change it on first login)

### 4. API (optional in Phase 1)

```
dotnet run --project apps/api/Hrm.Api.csproj
```

API runs at https://localhost:7080 by default.

### 5. ZKT Agent (K40 without ADMS)

A Windows worker on the same LAN as the device pulls logs via **zkemkeeper** (ZKTime SDK) and writes to Supabase.

```
dotnet run --project apps/agent/Hrm.ZktAgent.csproj
```

See [apps/agent/README.md](apps/agent/README.md). Requires .NET 8, ZKTime installed on the PC, device **IP** in Admin → Devices, and migration `0035_zkt_agent_sync.sql`.

## Security

- Never commit `.env` files
- Database password and service-role key live in environment variables only
- All tables have Row Level Security enabled; policies are written explicitly
- Two-factor auth available for admin/HR users
- IP restriction can be enabled per role

## Phase Plan

This is Phase 1 of 10. See the plan document for the full roadmap.

| Phase | Scope |
|-------|-------|
| 1 (current) | Foundation: auth, users, roles, permissions, audit |
| 2 | Master data (company, branches, departments, employees, shifts, holidays) + Excel I/O |
| 3 | Attendance (ZKTeco + agent + manual + aggregation + SignalR live) |
| 4 | Leave + Short Leave + Overtime |
| 5 | Payroll core (multi-frequency, FBR tax toggle, EOBI/PF/SS, payslip, bank file) |
| 6 | Loans, Expense claims, Annual Tax Certificate |
| 7 | Face kiosk + Mobile ESS |
| 8 | Letters, Announcements, Resignation + Exit |
| 9 | Recruitment / ATS |
| 10 | Reports + Dashboards + Polish |
