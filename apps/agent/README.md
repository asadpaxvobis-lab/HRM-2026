# HRM ZKT Agent (Windows)

Pulls attendance from **ZKTeco K40** (and similar) over **LAN port 4370** — **no ADMS / cloud push** required.

## Resume checklist

| Step | Status | Action |
|------|--------|--------|
| .NET 8 SDK | Done | `dotnet --version` → 8.0.x |
| Agent code | Done | `apps/agent/` |
| Supabase migration **0035** | **Pending** | Run `supabase/APPLY_0035_ZKT_AGENT.sql` in [SQL Editor](https://supabase.com/dashboard/project/zxkkmwycimijvbpgqpfh/sql/new) |
| `appsettings.Local.json` | **Pending** | Copy from `appsettings.example.json`, add **service role** key |
| Device IP in HRM | Done | `192.168.18.199` on OFFICE DEVICE |
| ZKTime on sync PC | Required | Same PC that runs the agent (your **Attendance Management Program** is correct) |
| **32-bit agent** | Required | ZKTime registers **32-bit** zkemkeeper — agent must be `win-x86`, not x64 |
| Run agent | Next | `dotnet run` from `apps/agent` |

```
K40 (192.168.x.x:4370)  →  zkemkeeper COM  →  Hrm.ZktAgent  →  Supabase attendance_punches
```

## Requirements

| Item | Notes |
|------|--------|
| Windows 10/11 PC | Same network as the K40 |
| .NET 8 SDK | https://dotnet.microsoft.com/download |
| ZKTime or ZKBio Time | Registers **zkemkeeper** COM (same SDK as Attendance Management Program) |
| Supabase **service role** key | Dashboard → Settings → API (keep secret) |
| HRM device row | **Admin → Devices** → ZKTeco, **IP** filled (e.g. `192.168.18.199`) |
| Employees | **Device PIN** = user ID on the device |

## Start from HRM web (Admin → Devices → **Run agent**)

On the **office PC** (HRM open at `http://localhost:5173`):

1. Run setup once: `powershell -ExecutionPolicy Bypass -File .\setup-agent.ps1` (registers `hrm-agent://` URL).
2. Leave launcher running (recommended): `powershell -ExecutionPolicy Bypass -File .\agent-launcher.ps1`  
   Or from repo root: `npm run launcher:agent`
3. In HRM **Admin → Devices**, click **Run agent** — opens `run-agent.ps1` in a new PowerShell window.

## Setup

1. Run migration `supabase/migrations/0035_zkt_agent_sync.sql` in Supabase SQL Editor.

2. Copy config:
   ```
   copy appsettings.example.json appsettings.Local.json
   ```
   Edit `Supabase:Url` and `Supabase:ServiceRoleKey`.

3. In HRM **Admin → Devices**, set **IP address** on **OFFICE DEVICE** (and serial if needed).

4. Build and run:
   ```powershell
   cd apps/agent
   dotnet run --project Hrm.ZktAgent.csproj
   ```

   Or from repo root:
   ```powershell
   dotnet run --project apps/agent/Hrm.ZktAgent.csproj
   ```

5. Optional — environment variables (override appsettings):
   ```
   Supabase__Url
   Supabase__ServiceRoleKey
   Agent__PollIntervalSeconds
   ```

## Run as Windows Service (production)

```powershell
dotnet publish apps/agent/Hrm.ZktAgent.csproj -c Release -o C:\HrmZktAgent
sc.exe create HrmZktAgent binPath= "C:\HrmZktAgent\Hrm.ZktAgent.exe" start= auto
sc.exe start HrmZktAgent
```

Use **Services.msc** to set “Log On” as a user on the LAN.

## How sync works

1. Every **120s** (default), loads active ZKTeco devices with an IP from Supabase.
2. Connects via **zkemkeeper** `Connect_Net(ip, 4370)`.
3. Reads general attendance logs (`ReadGeneralLogData` / `SSR_GetGeneralLogData`).
4. Skips logs already synced (cursor in `%ProgramData%\HrmZktAgent\state\{device-id}.json`).
5. Maps **PIN → employee.device_pin**, inserts `attendance_punches` (`source: zkteco`).
6. Calls `recompute_attendance_for_employee` per employee/day.
7. Updates `attendance_devices.agent_last_sync_at` and `last_seen_at`.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `zkemkeeper COM is not registered` | Run agent on the **same PC** as ZKTime. Rebuild as **x86** (`dotnet build` — project targets win-x86). If ZKTime works but agent fails, you were likely running a 64-bit build. |
| `Connect_Net failed` | Ping device IP; port **4370**. **Disconnect** device in ZKTime first (only one app at a time). |
| Data in ZKTime but not HRM | ZKTime does not send to HRM — run **Hrm.ZktAgent** (`.\run-agent.ps1`). |
| `unmapped PINs` | Set **Device PIN** in HRM employee form |
| Duplicates skipped | Normal — unique index on employee + punch time |
| Wrong times | Device timezone should match company (default PK +5 in agent) |

## Logs

- Console + `apps/agent/logs/zkt-agent-*.log` when run from agent folder.

## Security

- Never commit `appsettings.Local.json` or service role keys.
- Agent PC should be trusted; service role bypasses RLS.
