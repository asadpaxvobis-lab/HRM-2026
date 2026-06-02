using Hrm.ZktAgent.Models;

namespace Hrm.ZktAgent.Services;

public sealed class ZkFetchLogCollector
{
    private readonly int _maxEntries;
    private readonly List<ZkFetchLogEntryDraft> _entries = [];
    private int _excludedBeforeCursor;

    public ZkFetchLogCollector(int maxEntries = 500) => _maxEntries = Math.Max(50, maxEntries);

    public DateTimeOffset StartedAt { get; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? SinceCursor { get; private set; }
    public int LogsRead { get; private set; }
    public int ExcludedBeforeCursor => _excludedBeforeCursor;

    public void SetSinceCursor(DateTimeOffset? since) => SinceCursor = since;

    public void SetReadStats(int logsAfterCursor, int excludedBeforeCursor)
    {
        LogsRead = logsAfterCursor;
        _excludedBeforeCursor = excludedBeforeCursor;
        if (excludedBeforeCursor > 0)
        {
            Add(
                null,
                null,
                "before_cursor",
                $"{excludedBeforeCursor} punch(es) on device are older than sync cursor ({SinceCursor:yyyy-MM-dd HH:mm} UTC).");
        }
    }

    public void AddCapped(IReadOnlyList<ZkAttendanceLog> dropped)
    {
        foreach (var log in dropped)
        {
            Add(
                log.Pin,
                log.PunchAt,
                "capped",
                $"Not processed this cycle — batch limited to newest punches (oldest dropped: {log.PunchAt:u}).");
        }
    }

    public void AddUnmapped(ZkAttendanceLog log) =>
        Add(
            log.Pin,
            log.PunchAt,
            "unmapped_pin",
            $"No employee mapped to device PIN {log.Pin}. Set Device PIN in HRM or employee_device_pins.");

    public void AddDuplicate(int pin, DateTimeOffset punchAt, Guid employeeId) =>
        Add(
            pin,
            punchAt,
            "duplicate",
            "Already in attendance_punches for this employee and time.",
            employeeId);

    public void AddInserted(int pin, DateTimeOffset punchAt, Guid employeeId) =>
        Add(
            pin,
            punchAt,
            "inserted",
            "Inserted into attendance_punches.",
            employeeId);

    public void AddError(string message) =>
        Add(null, null, "error", message);

    public IReadOnlyList<ZkFetchLogEntryDraft> Entries => _entries;

    public int MappedCount => _entries.Count(e => e.Outcome is "inserted" or "duplicate");
    public int InsertedCount => _entries.Count(e => e.Outcome == "inserted");
    public int DuplicateCount => _entries.Count(e => e.Outcome == "duplicate");
    public int SkippedCount => _entries.Count(e => e.Outcome is not "inserted");

    private void Add(int? pin, DateTimeOffset? punchAt, string outcome, string reason, Guid? employeeId = null)
    {
        if (_entries.Count >= _maxEntries)
        {
            return;
        }

        _entries.Add(new ZkFetchLogEntryDraft(pin, punchAt, outcome, reason, employeeId));
    }
}

public sealed record ZkFetchLogEntryDraft(
    int? DevicePin,
    DateTimeOffset? PunchAt,
    string Outcome,
    string Reason,
    Guid? EmployeeId);

public sealed record ZkFetchRunDraft(
    Guid CompanyId,
    Guid DeviceId,
    DateTimeOffset StartedAt,
    DateTimeOffset FinishedAt,
    bool Success,
    DateTimeOffset? SinceCursor,
    int LogsRead,
    int ExcludedBeforeCursor,
    int MappedCount,
    int InsertedCount,
    int DuplicateCount,
    int SkippedCount,
    string? Summary,
    string? ErrorMessage,
    IReadOnlyList<ZkFetchLogEntryDraft> Entries);
