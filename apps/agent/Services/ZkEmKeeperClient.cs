using System.Runtime.InteropServices;
using Hrm.ZktAgent.Models;
using Microsoft.Extensions.Logging;

namespace Hrm.ZktAgent.Services;

/// <summary>
/// Reads attendance logs from ZKTeco terminals via zkemkeeper COM (installed with ZKTime / ZKBio).
/// Works with K40 and other Standalone SDK devices on TCP 4370 — no ADMS required.
/// </summary>
public sealed class ZkEmKeeperClient : IDisposable
{
    private static readonly string[] ProgIds =
    [
        "zkemkeeper.CZKEM",
        "zkemkeeper.CZKEM.1",
        "zkemkeeper.ZKEM",
        "zkemkeeper.ZKEM.1",
    ];

    private readonly ILogger<ZkEmKeeperClient> _logger;
    private dynamic? _zk;
    private bool _connected;

    public ZkEmKeeperClient(ILogger<ZkEmKeeperClient> logger) => _logger = logger;

    public bool IsZkEmKeeperAvailable()
    {
        foreach (var progId in ProgIds)
        {
            var t = Type.GetTypeFromProgID(progId, throwOnError: false);
            if (t != null) return true;
        }
        return false;
    }

    public void Connect(string ip, int port, int machineNumber, int commPassword, int timeoutSeconds = 12)
    {
        var connectTask = Task.Run(() => ConnectCore(ip, port, machineNumber, commPassword));
        if (!connectTask.Wait(TimeSpan.FromSeconds(Math.Max(3, timeoutSeconds))))
        {
            Disconnect();
            throw new TimeoutException(
                $"Connect to {ip}:{port} timed out after {timeoutSeconds}s. Check IP, power, and disconnect ZKTime.");
        }

        connectTask.GetAwaiter().GetResult();
    }

    private void ConnectCore(string ip, int port, int machineNumber, int commPassword)
    {
        Disconnect();
        _zk = CreateComInstance();
        if (_zk == null)
        {
            throw new InvalidOperationException(
                "zkemkeeper COM is not registered. Install ZKTime / ZKBio Time (includes zkemkeeper.dll) on this PC, then restart the agent.");
        }

        if (commPassword != 0)
        {
            _zk.SetCommPassword(commPassword);
        }

        var ok = (bool)_zk.Connect_Net(ip, port);
        if (!ok)
        {
            var err = SafeGetLastError();
            throw new InvalidOperationException(
                $"Connect_Net({ip}:{port}) failed. zkemkeeper error {err}. " +
                "If ZKTime shows Connected, click Disconnect there first — only one program can use the device at a time.");
        }

        _zk.EnableDevice(machineNumber, false);
        _connected = true;
        _logger.LogInformation("Connected to ZKTeco at {Ip}:{Port} (machine {Machine})", ip, port, machineNumber);
    }

    public IReadOnlyList<ZkAttendanceLog> ReadAllLogs(
        int machineNumber,
        DateTimeOffset? sinceUtc,
        Action<int>? onRowsRead = null)
    {
        if (_zk == null || !_connected)
        {
            throw new InvalidOperationException("Not connected to device.");
        }

        var logs = new List<ZkAttendanceLog>();

        // Older ZKTime SDK (e.g. 6.2.x) has no ReadNewGLogData — use ReadGeneralLogData only.
        if (!(bool)_zk!.ReadGeneralLogData(machineNumber))
        {
            try
            {
                if (!(bool)_zk.ReadAllGLogData(machineNumber))
                {
                    var err = SafeGetLastError();
                    throw new InvalidOperationException($"ReadGeneralLogData failed. zkemkeeper error {err}.");
                }
            }
            catch (Microsoft.CSharp.RuntimeBinder.RuntimeBinderException)
            {
                var err = SafeGetLastError();
                throw new InvalidOperationException($"ReadGeneralLogData failed. zkemkeeper error {err}.");
            }
        }

        try
        {
            ReadSsrRows(machineNumber, logs, onRowsRead);
        }
        catch (Microsoft.CSharp.RuntimeBinder.RuntimeBinderException)
        {
            // SSR not on this SDK
        }

        if (logs.Count == 0)
        {
            ReadLegacyRows(machineNumber, logs, onRowsRead);
        }

        _logger.LogInformation("Read {Count} log rows from device buffer", logs.Count);

        if (sinceUtc.HasValue)
        {
            var before = logs.Count;
            logs = logs.Where(l => l.PunchAt > sinceUtc.Value).ToList();
            _logger.LogInformation("After since {Since}: {Count} rows (dropped {Dropped})", sinceUtc.Value.ToString("u"), logs.Count, before - logs.Count);
        }

        return logs.OrderBy(l => l.PunchAt).ToList();
    }

    public void Disconnect()
    {
        if (_zk == null) return;
        try
        {
            if (_connected)
            {
                _zk.EnableDevice(1, true);
                _zk.Disconnect();
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Disconnect cleanup");
        }
        finally
        {
            if (_zk != null && Marshal.IsComObject(_zk))
            {
                Marshal.FinalReleaseComObject(_zk);
            }
            _zk = null;
            _connected = false;
        }
    }

    public void Dispose() => Disconnect();

    private dynamic? CreateComInstance()
    {
        foreach (var progId in ProgIds)
        {
            try
            {
                var t = Type.GetTypeFromProgID(progId, throwOnError: false);
                if (t == null) continue;
                var inst = Activator.CreateInstance(t);
                if (inst != null)
                {
                    _logger.LogDebug("Using zkemkeeper ProgID {ProgId}", progId);
                    return inst;
                }
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "ProgID {ProgId} failed", progId);
            }
        }
        return null;
    }

    private void ReadLegacyRows(int machineNumber, List<ZkAttendanceLog> logs, Action<int>? onRowsRead = null)
    {
        var pkOffset = TimeSpan.FromHours(5);
        var pin = 0;
        var verify = 0;
        var inOut = 0;
        var year = 0;
        var month = 0;
        var day = 0;
        var hour = 0;
        var minute = 0;
        var second = 0;
        var workCode = 0;
        while (true)
        {
            var rowOk = (bool)_zk!.GetGeneralLogData(
                machineNumber, ref pin, ref verify, ref inOut,
                ref year, ref month, ref day, ref hour, ref minute, ref second, ref workCode);
            if (!rowOk) break;
            if (pin <= 0 || year < 2000) continue;

            var local = new DateTime(year, month, day, hour, minute, second, DateTimeKind.Unspecified);
            logs.Add(new ZkAttendanceLog(pin, new DateTimeOffset(local, pkOffset), InOutToPunchType(inOut), verify, inOut));
            if (logs.Count % 500 == 0)
            {
                onRowsRead?.Invoke(logs.Count);
            }
        }
        onRowsRead?.Invoke(logs.Count);
    }

    private void ReadSsrRows(int machineNumber, List<ZkAttendanceLog> logs, Action<int>? onRowsRead = null)
    {
        var pkOffset = TimeSpan.FromHours(5);

        while (true)
        {
            string enroll = "";
            int verify = 0, inOut = 0, year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0;
            int workCode = 0;

            var rowOk = (bool)_zk!.SSR_GetGeneralLogData(
                machineNumber,
                out enroll,
                out verify,
                out inOut,
                out year,
                out month,
                out day,
                out hour,
                out minute,
                out second,
                ref workCode);

            if (!rowOk) break;
            if (!int.TryParse(enroll.Trim(), out var pin) || pin <= 0) continue;
            if (year < 2000) continue;

            var local = new DateTime(year, month, day, hour, minute, second, DateTimeKind.Unspecified);
            var punchAt = new DateTimeOffset(local, pkOffset);

            logs.Add(new ZkAttendanceLog(
                pin,
                punchAt,
                InOutToPunchType(inOut),
                verify,
                inOut));
            if (logs.Count % 500 == 0)
            {
                onRowsRead?.Invoke(logs.Count);
            }
        }
        onRowsRead?.Invoke(logs.Count);
    }

    private static string InOutToPunchType(int inOut) => inOut switch
    {
        0 => "in",
        1 => "out",
        _ => "auto",
    };

    private int SafeGetLastError()
    {
        try
        {
            return _zk != null ? (int)_zk.GetLastError() : -1;
        }
        catch
        {
            return -1;
        }
    }
}
