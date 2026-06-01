using Hrm.ZktAgent.Options;
using Hrm.ZktAgent.Services;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Hrm.ZktAgent.Worker;

public sealed class AttendanceSyncWorker : BackgroundService
{
    private readonly ILogger<AttendanceSyncWorker> _logger;
    private readonly AgentOptions _agent;
    private readonly AttendanceSyncService _sync;
    private readonly ZkEmKeeperClient _zk;

    public AttendanceSyncWorker(
        ILogger<AttendanceSyncWorker> logger,
        IOptions<AgentOptions> agent,
        AttendanceSyncService sync,
        ZkEmKeeperClient zk)
    {
        _logger = logger;
        _agent = agent.Value;
        _sync = sync;
        _zk = zk;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_zk.IsZkEmKeeperAvailable())
        {
            _logger.LogError(
                "zkemkeeper is not installed. Install ZKTime / ZKBio Time on this PC, then restart the agent.");
            await Task.Delay(Timeout.Infinite, stoppingToken);
            return;
        }

        _logger.LogInformation("HRM ZKT Agent started. Poll every {Seconds}s.", _agent.PollIntervalSeconds);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await _sync.SyncAllDevicesAsync(stoppingToken);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Sync cycle failed");
            }

            await Task.Delay(TimeSpan.FromSeconds(Math.Max(30, _agent.PollIntervalSeconds)), stoppingToken);
        }
    }
}
