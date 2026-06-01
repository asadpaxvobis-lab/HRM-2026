using System.Text.Json;
using Hrm.ZktAgent.Models;
using Hrm.ZktAgent.Options;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Hrm.ZktAgent.Services;

public sealed class AttendanceSyncService
{
    private readonly ILogger<AttendanceSyncService> _logger;
    private readonly AgentOptions _agent;
    private readonly SupabaseHrmClient _hrm;
    private readonly ZkEmKeeperClient _zk;
    private readonly SyncStateStore _state;
    private readonly SyncProgressStore _progress;
    private readonly SemaphoreSlim _syncLock = new(1, 1);

    public AttendanceSyncService(
        ILogger<AttendanceSyncService> logger,
        IOptions<AgentOptions> agent,
        SupabaseHrmClient hrm,
        ZkEmKeeperClient zk,
        SyncStateStore state,
        SyncProgressStore progress)
    {
        _logger = logger;
        _agent = agent.Value;
        _hrm = hrm;
        _zk = zk;
        _state = state;
        _progress = progress;
    }

    public SyncProgressSnapshot GetProgress() => _progress.Snapshot();

    public void ResetSyncState(Guid? deviceId = null) => _state.Clear(deviceId);

    public bool StartBackgroundSync()
    {
        if (_progress.Snapshot().Running)
        {
            return false;
        }

        _ = Task.Run(async () =>
        {
            try
            {
                await SyncAllDevicesAsync(CancellationToken.None);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Background sync failed");
                if (!_progress.Snapshot().Done)
                {
                    _progress.Complete(false, [], ex.Message);
                }
            }
        });

        return true;
    }

    public async Task<IReadOnlyList<string>> SyncAllDevicesAsync(CancellationToken ct = default)
    {
        await _syncLock.WaitAsync(ct);
        try
        {
            _hrm.EnsureConfigured();

            var devices = await _hrm.GetPullableDevicesAsync(ct);
            if (devices.Count == 0)
            {
                var msg = "No active ZKTeco devices with IP in HRM.";
                _progress.AddLine(msg);
                _progress.Complete(false, [msg], msg);
                return [msg];
            }

            _progress.BeginRun(devices.Count);
            _progress.AddLine($"Found {devices.Count} device(s) to sync");

            var results = new List<string>();
            for (var i = 0; i < devices.Count; i++)
            {
                results.Add(await SyncDeviceAsync(devices[i], i, devices.Count, ct));
            }

            _progress.Complete(true, results);
            return results;
        }
        catch (Exception ex)
        {
            _progress.Complete(false, [], ex.Message);
            throw;
        }
        finally
        {
            _syncLock.Release();
        }
    }

    private async Task<string> SyncDeviceAsync(HrmDevice device, int deviceIndex, int deviceCount, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(device.IpAddress))
        {
            return $"{device.Name}: no IP configured";
        }

        var ip = device.IpAddress.Trim();
        var localState = _state.Load(device.Id);
        var since = localState.LastPunchAtUtc
            ?? DateTimeOffset.UtcNow.AddDays(-_agent.InitialLookbackDays);

        var deviceBase = deviceCount > 0 ? (deviceIndex * 100) / deviceCount : 0;
        var deviceSlice = deviceCount > 0 ? Math.Max(1, 100 / deviceCount) : 100;

        _progress.SetDevice(device.Name, deviceIndex, deviceCount);
        _progress.AddLine($"Connecting to {ip}:4370…");
        _progress.SetPhase("connect", $"Connecting to {device.Name}…", 10, deviceSlice, deviceBase);

        _logger.LogInformation("Syncing {Name} @ {Ip} (since {Since})", device.Name, ip, since.ToString("u"));

        try
        {
            _zk.Connect(ip, _agent.DevicePort, _agent.MachineNumber, _agent.CommunicationPassword, _agent.ConnectTimeoutSeconds);
            _progress.AddLine("Connected — reading attendance logs from device…");
            _progress.SetPhase("read", "Reading logs from device (may take 1–2 min)…", 25, deviceSlice, deviceBase);

            var logs = _zk.ReadAllLogs(
                _agent.MachineNumber,
                since,
                rowsRead =>
                {
                    _progress.SetCounts(rowsRead, _progress.PunchesSent);
                    if (rowsRead % 2000 == 0)
                    {
                        _progress.AddLine($"Read {rowsRead:N0} rows from device memory…");
                        var readPct = 25 + Math.Min(35, rowsRead / 1200);
                        _progress.SetPhase("read", $"Reading… {rowsRead:N0} rows", readPct, deviceSlice, deviceBase);
                    }
                });

            _zk.Disconnect();
            _progress.SetCounts(logs.Count, 0);
            _progress.AddLine($"Device buffer: {logs.Count:N0} log(s) in date range");

            if (logs.Count == 0)
            {
                var noNewMsg =
                    $"OK — no punches newer than {since:yyyy-MM-dd HH:mm} UTC. " +
                    "If you expected data: map employee Device PINs in HRM, or use Reset sync cursor and pull again.";
                await _hrm.UpdateDeviceSyncStatusAsync(device.Id, noNewMsg, ct);
                _state.Save(device.Id, localState);
                _progress.AddLine(noNewMsg);
                _progress.SetPhase("done", "No new punches in date range", 100, deviceSlice, deviceBase);
                return $"{device.Name}: {noNewMsg}";
            }

            if (logs.Count > _agent.MaxPunchesPerSync)
            {
                logs = logs.OrderBy(l => l.PunchAt).TakeLast(_agent.MaxPunchesPerSync).ToList();
                _progress.AddLine($"Capped to last {_agent.MaxPunchesPerSync:N0} punches this cycle");
            }

            _progress.SetPhase("map", "Matching employee PINs…", 65, deviceSlice, deviceBase);
            var pinMap = await _hrm.GetEmployeePinsAsync(device.CompanyId, ct);
            _progress.AddLine($"Loaded {pinMap.Count} employee PIN mapping(s) from HRM");

            var punches = new List<PunchInsert>();
            var recomputeKeys = new HashSet<(Guid EmployeeId, DateOnly Date)>();
            var unmapped = new HashSet<int>();
            var unmappedLogs = new List<ZkAttendanceLog>();
            DateTimeOffset? maxMappedPunch = null;

            foreach (var log in logs)
            {
                if (!pinMap.TryGetValue(log.Pin, out var employeeId))
                {
                    unmapped.Add(log.Pin);
                    unmappedLogs.Add(log);
                    continue;
                }

                var punchUtc = log.PunchAt.ToUniversalTime();
                punches.Add(new PunchInsert(
                    device.CompanyId,
                    employeeId,
                    device.Id,
                    punchUtc.UtcDateTime,
                    log.PunchType,
                    "zkteco",
                    JsonSerializer.SerializeToElement(new
                    {
                        agent = true,
                        pin = log.Pin,
                        verify_mode = log.VerifyMode,
                        in_out = log.InOutMode,
                        device_sn = device.SerialNo,
                    })));

                if (maxMappedPunch == null || log.PunchAt > maxMappedPunch)
                {
                    maxMappedPunch = log.PunchAt;
                }

                if (_agent.RecomputeAfterSync)
                {
                    recomputeKeys.Add((employeeId, DateOnly.FromDateTime(log.PunchAt.Date)));
                }
            }

            _progress.SetCounts(logs.Count, punches.Count);
            _progress.AddLine($"Mapped {punches.Count} punch(es) to employees ({unmapped.Count} unmapped PIN(s))");
            _progress.SetPhase("upload", $"Uploading {punches.Count} punch(es) to Supabase…", 78, deviceSlice, deviceBase);

            var inserted = await _hrm.InsertPunchesAsync(punches, ct);
            _progress.SetCounts(logs.Count, punches.Count, inserted);
            _progress.AddLine($"Supabase: inserted ~{inserted} new row(s) (duplicates skipped)");

            if (_agent.RecomputeAfterSync && recomputeKeys.Count > 0)
            {
                _progress.SetPhase("recompute", $"Updating daily attendance ({recomputeKeys.Count} day(s))…", 90, deviceSlice, deviceBase);
                var n = 0;
                foreach (var (employeeId, date) in recomputeKeys)
                {
                    await _hrm.RecomputeAsync(employeeId, date, ct);
                    n++;
                    if (n % 10 == 0)
                    {
                        _progress.AddLine($"Recomputed {n}/{recomputeKeys.Count} employee-day(s)…");
                    }
                }
            }

            var note = $"OK — read {logs.Count}, sent {punches.Count}, inserted ~{inserted}";
            if (unmapped.Count > 0)
            {
                note += $"; unmapped PINs: {string.Join(", ", unmapped.OrderBy(x => x))}";
            }

            await _hrm.UpdateDeviceSyncStatusAsync(device.Id, note, ct);

            // Do not skip past unmapped punches — retry them after Device PINs are set in HRM.
            if (unmappedLogs.Count > 0)
            {
                var oldestUnmapped = unmappedLogs.Min(l => l.PunchAt);
                var cursor = oldestUnmapped.AddSeconds(-1).ToUniversalTime();
                if (localState.LastPunchAtUtc == null || cursor < localState.LastPunchAtUtc)
                {
                    localState.LastPunchAtUtc = cursor;
                }

                _progress.AddLine(
                    $"Cursor held at {localState.LastPunchAtUtc:u} until unmapped PINs are configured in HRM.");
            }
            else if (maxMappedPunch.HasValue)
            {
                localState.LastPunchAtUtc = maxMappedPunch.Value.ToUniversalTime();
            }

            _state.Save(device.Id, localState);

            _progress.SetPhase("done", note, 100, deviceSlice, deviceBase);
            _progress.AddLine($"{device.Name}: {note}");
            _logger.LogInformation("{Device}: {Note}", device.Name, note);
            return $"{device.Name}: {note}";
        }
        catch (Exception ex)
        {
            _zk.Disconnect();
            var msg = $"Error: {ex.Message}";
            _progress.AddLine(msg);
            _logger.LogError(ex, "Failed syncing {Device}", device.Name);
            try
            {
                await _hrm.UpdateDeviceSyncStatusAsync(device.Id, msg, ct);
            }
            catch (Exception patchEx)
            {
                _logger.LogWarning(patchEx, "Could not write device sync status");
            }

            return $"{device.Name}: {msg}";
        }
    }
}
