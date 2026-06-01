namespace Hrm.ZktAgent.Models;

public sealed record ZkBioScanResult(IReadOnlyList<ZkUserBioStatus> Users, bool SupportsFace);
