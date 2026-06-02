namespace Hrm.ZktAgent.Services;

/// <summary>Last sync cycle results for GET /status (local UI).</summary>
public sealed class AgentCycleStatusStore
{
    private readonly object _gate = new();
    private AgentCycleSnapshot _snapshot = new(false, null, [], DateTimeOffset.MinValue);

    public AgentCycleSnapshot Snapshot()
    {
        lock (_gate)
        {
            return _snapshot;
        }
    }

    public void SetSyncing(bool syncing, string? summary = null)
    {
        lock (_gate)
        {
            _snapshot = _snapshot with { Syncing = syncing, Summary = summary ?? _snapshot.Summary };
        }
    }

    public void Complete(IReadOnlyList<DeviceCycleStatus> devices, string summary)
    {
        lock (_gate)
        {
            _snapshot = new AgentCycleSnapshot(false, summary, devices, DateTimeOffset.UtcNow);
        }
    }
}

public sealed record AgentCycleSnapshot(
    bool Syncing,
    string? Summary,
    IReadOnlyList<DeviceCycleStatus> Devices,
    DateTimeOffset CompletedAt);

public sealed record DeviceCycleStatus(
    Guid Id,
    string Name,
    string? Ip,
    bool Connected,
    string Message);
