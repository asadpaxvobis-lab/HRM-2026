using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using Hrm.ZktAgent.Models;
using Microsoft.Extensions.Logging;

namespace Hrm.ZktAgent.Services;

/// <summary>
/// Reads attendance logs from ZKTeco terminals via zkemkeeper COM (installed with ZKTime / ZKBio).
/// Works with K40 and other Standalone SDK devices on TCP 4370 — no ADMS required.
/// </summary>
[SupportedOSPlatform("windows")]
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
    private readonly object _gate = new();
    private dynamic? _zk;
    private bool _connected;
    private string? _connectedIp;

    public ZkEmKeeperClient(ILogger<ZkEmKeeperClient> logger) => _logger = logger;

    public string? ConnectedIp => _connectedIp;

    internal static string FriendlyError(Exception ex)
    {
        if (ex is AggregateException agg && agg.InnerException != null)
        {
            return FriendlyError(agg.InnerException);
        }

        return ex.Message;
    }

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
        lock (_gate)
        {
            var connectTask = Task.Run(() => ConnectCore(ip, port, machineNumber, commPassword));
            if (!connectTask.Wait(TimeSpan.FromSeconds(Math.Max(3, timeoutSeconds))))
            {
                DisconnectCore();
                throw new TimeoutException(
                    $"Connect to {ip}:{port} timed out after {timeoutSeconds}s. Check IP, power, and disconnect ZKTime.");
            }

            try
            {
                connectTask.GetAwaiter().GetResult();
            }
            catch (AggregateException ex)
            {
                throw ex.InnerException ?? ex;
            }
        }
    }

    private void ConnectCore(string ip, int port, int machineNumber, int commPassword)
    {
        if (_connected && _connectedIp != null &&
            string.Equals(_connectedIp, ip, StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        DisconnectCore();
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
        _connectedIp = ip;
        _logger.LogInformation("Connected to ZKTeco at {Ip}:{Port} (machine {Machine})", ip, port, machineNumber);
    }

    public IReadOnlyList<ZkAttendanceLog> ReadAllLogs(
        int machineNumber,
        DateTimeOffset? sinceUtc,
        Action<int>? onRowsRead = null)
    {
        lock (_gate)
        {
            return ReadAllLogsCore(machineNumber, sinceUtc, onRowsRead);
        }
    }

    private IReadOnlyList<ZkAttendanceLog> ReadAllLogsCore(
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

    /// <summary>Reads each enrolled user on the device and whether fingerprint / face templates exist.</summary>
    public ZkBioScanResult ReadUserBioStatuses(int machineNumber)
    {
        lock (_gate)
        {
            return ReadUserBioStatusesCore(machineNumber);
        }
    }

    private ZkBioScanResult ReadUserBioStatusesCore(int machineNumber)
    {
        if (_zk == null || !_connected)
        {
            throw new InvalidOperationException("Not connected to device.");
        }

        var results = new List<ZkUserBioStatus>();
        var supportsFace = true;
        dynamic zk = _zk;

        if (!(bool)zk.ReadAllUserID(machineNumber))
        {
            _logger.LogWarning("ReadAllUserID returned false; bio scan may be incomplete (error {Err})", SafeGetLastError());
        }

        var ssrCount = ReadBioStatusesSsr(machineNumber, results, ref supportsFace);
        if (ssrCount == 0)
        {
            ReadBioStatusesLegacy(machineNumber, results, ref supportsFace);
        }

        var deviceSupportsFace = supportsFace;
        if (!supportsFace)
        {
            for (var i = 0; i < results.Count; i++)
            {
                var row = results[i];
                results[i] = row with { HasFace = true };
            }
        }

        return new ZkBioScanResult(results.OrderBy(r => r.Pin).ToList(), deviceSupportsFace);
    }

    public void Disconnect()
    {
        lock (_gate)
        {
            DisconnectCore();
        }
    }

    private void DisconnectCore()
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
            _connectedIp = null;
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

    private int ReadBioStatusesSsr(int machineNumber, List<ZkUserBioStatus> results, ref bool supportsFace)
    {
        var seen = new HashSet<int>();
        var count = 0;

        while (true)
        {
            string enroll = "";
            string name = "";
            string password = "";
            var privilege = 0;
            var enabled = false;

            bool rowOk;
            try
            {
                rowOk = (bool)_zk!.SSR_GetAllUserInfo(
                    machineNumber,
                    out enroll,
                    out name,
                    out password,
                    out privilege,
                    out enabled);
            }
            catch (Microsoft.CSharp.RuntimeBinder.RuntimeBinderException)
            {
                break;
            }

            if (!rowOk) break;
            if (!int.TryParse(enroll.Trim(), out var pin) || pin <= 0) continue;
            if (!seen.Add(pin)) continue;

            var hasFinger = HasFingerprintSsr(machineNumber, enroll);
            var hasFace = supportsFace && HasFaceTemplate(machineNumber, enroll, ref supportsFace);
            results.Add(new ZkUserBioStatus(pin, hasFinger, hasFace));
            count++;
        }

        return count;
    }

    private void ReadBioStatusesLegacy(int machineNumber, List<ZkUserBioStatus> results, ref bool supportsFace)
    {
        var seen = new HashSet<int>();
        while (true)
        {
            var pin = 0;
            var name = "";
            var password = "";
            var privilege = 0;
            var enabled = false;

            bool rowOk;
            try
            {
                rowOk = (bool)_zk!.GetAllUserInfo(
                    machineNumber,
                    ref pin,
                    ref name,
                    ref password,
                    ref privilege,
                    ref enabled);
            }
            catch (Microsoft.CSharp.RuntimeBinder.RuntimeBinderException)
            {
                break;
            }

            if (!rowOk) break;
            if (pin <= 0 || !seen.Add(pin)) continue;

            var hasFinger = HasFingerprintLegacy(machineNumber, pin);
            var enroll = pin.ToString();
            var hasFace = supportsFace && HasFaceTemplate(machineNumber, enroll, ref supportsFace);
            results.Add(new ZkUserBioStatus(pin, hasFinger, hasFace));
        }
    }

    private bool HasFingerprintSsr(int machineNumber, string enroll)
    {
        for (var finger = 0; finger < 10; finger++)
        {
            try
            {
                string tmp = "";
                var len = 0;
                if ((bool)_zk!.SSR_GetUserTmpStr(machineNumber, enroll, finger, out tmp, out len) && len > 0)
                {
                    return true;
                }
            }
            catch (Microsoft.CSharp.RuntimeBinder.RuntimeBinderException)
            {
                return HasFingerprintLegacy(machineNumber, int.Parse(enroll));
            }
        }

        return false;
    }

    private bool HasFingerprintLegacy(int machineNumber, int pin)
    {
        for (var finger = 0; finger < 10; finger++)
        {
            try
            {
                var tmp = new byte[0];
                var len = 0;
                if ((bool)_zk!.GetUserTmp(machineNumber, pin, finger, ref tmp, ref len) && len > 0)
                {
                    return true;
                }
            }
            catch (Microsoft.CSharp.RuntimeBinder.RuntimeBinderException)
            {
                break;
            }
        }

        return false;
    }

    private bool HasFaceTemplate(int machineNumber, string enroll, ref bool supportsFace)
    {
        foreach (var faceIndex in new[] { 0, 50 })
        {
            try
            {
                string tmp = "";
                var len = 0;
                if ((bool)_zk!.GetUserFaceStr(machineNumber, enroll, faceIndex, ref tmp, ref len) && len > 0)
                {
                    return true;
                }
            }
            catch (Microsoft.CSharp.RuntimeBinder.RuntimeBinderException)
            {
                supportsFace = false;
                return false;
            }
        }

        return false;
    }
}
