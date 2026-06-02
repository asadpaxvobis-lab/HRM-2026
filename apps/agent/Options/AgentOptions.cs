namespace Hrm.ZktAgent.Options;

public sealed class AgentOptions
{
    public const string SectionName = "Agent";

    /// <summary>How often the agent pulls new punches from all ZKTeco devices (minimum 10).</summary>
    public int PollIntervalSeconds { get; set; } = 10;

    public int DevicePort { get; set; } = 4370;

    /// <summary>ZKT machine number (Connect setup → Device Number), usually 1.</summary>
    public int MachineNumber { get; set; } = 1;

    /// <summary>Communication key on device (often 0).</summary>
    public int CommunicationPassword { get; set; }

    /// <summary>Per-device sync cursor files. Empty = %ProgramData%/HrmZktAgent/state</summary>
    public string StateDirectory { get; set; } = "";

    public bool RecomputeAfterSync { get; set; } = true;

    /// <summary>On first sync (no cursor), only import punches within this many days.</summary>
    public int InitialLookbackDays { get; set; } = 90;

    /// <summary>Max seconds to wait for device TCP connect before skipping.</summary>
    public int ConnectTimeoutSeconds { get; set; } = 12;

    /// <summary>Max punches uploaded per device per cycle (avoids huge first imports).</summary>
    public int MaxPunchesPerSync { get; set; } = 2000;

    /// <summary>Local HTTP API for HRM web "Pull now" button (office PC only).</summary>
    public bool EnableHttpTrigger { get; set; } = true;

    public int TriggerPort { get; set; } = 17880;

    /// <summary>
    /// Also listen on all interfaces (http://+:port/) so other PCs on the LAN can use Admin → Devices.
    /// Requires URL reservation once per PC — run-agent.ps1 registers it automatically.
    /// </summary>
    public bool ListenOnLan { get; set; } = true;
}

public sealed class SupabaseOptions
{
    public const string SectionName = "Supabase";

    public string Url { get; set; } = "";
    public string ServiceRoleKey { get; set; } = "";
}
