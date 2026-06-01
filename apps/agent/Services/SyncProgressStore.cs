namespace Hrm.ZktAgent.Services;

public sealed class SyncProgressStore
{
    private readonly object _lock = new();
    private readonly List<string> _lines = [];
    private const int MaxLines = 40;

    public SyncProgressSnapshot Snapshot()
    {
        lock (_lock)
        {
            return new SyncProgressSnapshot
            {
                Running = Running,
                Percent = Percent,
                Phase = Phase,
                Message = Message,
                DeviceName = DeviceName,
                LogsRead = LogsRead,
                PunchesSent = PunchesSent,
                PunchesInserted = PunchesInserted,
                Lines = _lines.ToList(),
                Done = Done,
                Ok = Ok,
                Results = Results?.ToList(),
                Error = Error,
            };
        }
    }

    public bool Running { get; private set; }
    public int Percent { get; private set; }
    public string Phase { get; private set; } = "idle";
    public string Message { get; private set; } = "Waiting";
    public string? DeviceName { get; private set; }
    public int LogsRead { get; private set; }
    public int PunchesSent { get; private set; }
    public int PunchesInserted { get; private set; }
    public bool Done { get; private set; }
    public bool Ok { get; private set; }
    public IReadOnlyList<string>? Results { get; private set; }
    public string? Error { get; private set; }

    public void BeginRun(int deviceCount)
    {
        lock (_lock)
        {
            Running = true;
            Done = false;
            Ok = false;
            Results = null;
            Error = null;
            LogsRead = 0;
            PunchesSent = 0;
            PunchesInserted = 0;
            _lines.Clear();
            Set(2, "starting", $"Starting sync for {deviceCount} device(s)…", null);
        }
    }

    public void SetDevice(string name, int deviceIndex, int deviceCount)
    {
        var basePct = deviceCount > 0 ? (deviceIndex * 100) / deviceCount : 0;
        var slice = deviceCount > 0 ? 100 / deviceCount : 100;
        lock (_lock)
        {
            DeviceName = name;
            var pct = Math.Min(99, basePct + (int)(slice * 0.05));
            Set(pct, "device", $"Device {deviceIndex + 1}/{deviceCount}: {name}", name);
        }
    }

    public void SetPhase(string phase, string message, int percentWithinDevice, int deviceSlicePercent, int deviceBasePercent)
    {
        lock (_lock)
        {
            var pct = Math.Min(99, deviceBasePercent + (deviceSlicePercent * percentWithinDevice / 100));
            Set(pct, phase, message, DeviceName);
        }
    }

    public void SetCounts(int logsRead, int punchesSent, int? punchesInserted = null)
    {
        lock (_lock)
        {
            LogsRead = logsRead;
            PunchesSent = punchesSent;
            if (punchesInserted.HasValue)
            {
                PunchesInserted = punchesInserted.Value;
            }
        }
    }

    public void AddLine(string line)
    {
        lock (_lock)
        {
            _lines.Add($"[{DateTime.Now:HH:mm:ss}] {line}");
            if (_lines.Count > MaxLines)
            {
                _lines.RemoveAt(0);
            }
        }
    }

    public void Complete(bool ok, IReadOnlyList<string> results, string? error = null)
    {
        lock (_lock)
        {
            Running = false;
            Done = true;
            Ok = ok;
            Results = results;
            Error = error;
            Percent = 100;
            Phase = ok ? "done" : "error";
            Message = ok ? "Sync finished" : (error ?? "Sync failed");
            AddLine(Message);
        }
    }

    private void Set(int percent, string phase, string message, string? deviceName)
    {
        Percent = Math.Clamp(percent, 0, 100);
        Phase = phase;
        Message = message;
        if (deviceName != null)
        {
            DeviceName = deviceName;
        }
    }
}

public sealed class SyncProgressSnapshot
{
    public bool Running { get; init; }
    public int Percent { get; init; }
    public string Phase { get; init; } = "";
    public string Message { get; init; } = "";
    public string? DeviceName { get; init; }
    public int LogsRead { get; init; }
    public int PunchesSent { get; init; }
    public int PunchesInserted { get; init; }
    public List<string> Lines { get; init; } = [];
    public bool Done { get; init; }
    public bool Ok { get; init; }
    public List<string>? Results { get; init; }
    public string? Error { get; init; }
}
