namespace Hrm.ZktAgent.Models;

public sealed record ZkAttendanceLog(
    int Pin,
    DateTimeOffset PunchAt,
    string PunchType,
    int VerifyMode,
    int InOutMode
);

public sealed record HrmDevice(
    Guid Id,
    Guid CompanyId,
    string Name,
    string? SerialNo,
    string? IpAddress,
    bool IsActive,
    DateTimeOffset? AgentLastSyncAt
);

public sealed record HrmEmployeePin(Guid Id, int DevicePin);

public sealed class DeviceSyncState
{
    public DateTimeOffset? LastPunchAtUtc { get; set; }
    public DateTimeOffset LastRunUtc { get; set; }
}
