using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Hrm.ZktAgent.Options;
using Hrm.ZktAgent.Services;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Hrm.ZktAgent.Worker;

/// <summary>
/// Local HTTP API so HRM web (Admin → Devices) can trigger a pull while the agent runs on the office PC.
/// </summary>
public sealed class AgentHttpTriggerService : BackgroundService
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly ILogger<AgentHttpTriggerService> _logger;
    private readonly AgentOptions _agent;
    private readonly AttendanceSyncService _sync;
    private readonly ZkEmKeeperClient _zk;

    public AgentHttpTriggerService(
        ILogger<AgentHttpTriggerService> logger,
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
        if (!_agent.EnableHttpTrigger)
        {
            return;
        }

        var listener = new HttpListener();
        var prefixes = new List<string> { $"http://127.0.0.1:{_agent.TriggerPort}/" };
        if (_agent.ListenOnLan)
        {
            prefixes.Add($"http://+:{_agent.TriggerPort}/");
        }

        foreach (var prefix in prefixes)
        {
            listener.Prefixes.Add(prefix);
        }

        try
        {
            listener.Start();
            _logger.LogInformation(
                "Agent trigger API listening on {Prefixes} (POST /sync, GET /sync/status, GET /health)",
                string.Join(", ", prefixes));
        }
        catch (Exception ex)
        {
            if (_agent.ListenOnLan && prefixes.Count > 1)
            {
                _logger.LogWarning(ex, "Could not bind LAN prefix http://+:{Port}/ — retrying localhost only", _agent.TriggerPort);
                listener = new HttpListener();
                listener.Prefixes.Add(prefixes[0]);
                try
                {
                    listener.Start();
                    _logger.LogInformation(
                        "Agent trigger API listening on {Prefix} only. For LAN access, run setup-agent.ps1 as Administrator.",
                        prefixes[0]);
                }
                catch (Exception ex2)
                {
                    _logger.LogError(
                        ex2,
                        "Could not start HTTP trigger. Run: powershell -ExecutionPolicy Bypass -File setup-agent.ps1");
                    return;
                }
            }
            else
            {
                _logger.LogError(
                    ex,
                    "Could not start HTTP trigger. Run: powershell -ExecutionPolicy Bypass -File setup-agent.ps1");
                return;
            }
        }

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var ctx = await listener.GetContextAsync().WaitAsync(stoppingToken);
                await HandleRequestAsync(ctx, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "HTTP trigger request failed");
            }
        }

        listener.Stop();
        listener.Close();
    }

    private async Task HandleRequestAsync(HttpListenerContext ctx, CancellationToken ct)
    {
        AddCors(ctx.Response);

        if (ctx.Request.HttpMethod == "OPTIONS")
        {
            ctx.Response.StatusCode = 204;
            ctx.Response.Close();
            return;
        }

        var path = ctx.Request.Url?.AbsolutePath.TrimEnd('/') ?? "";

        if (path.Equals("/health", StringComparison.OrdinalIgnoreCase) && ctx.Request.HttpMethod == "GET")
        {
            var zkOk = _zk.IsZkEmKeeperAvailable();
            await WriteJsonAsync(
                ctx,
                200,
                new
                {
                    ok = true,
                    service = "Hrm.ZktAgent",
                    zkemkeeper = zkOk,
                    hint = zkOk
                        ? (string?)null
                        : "Install ZKTime or ZKBio Time on this PC (registers 32-bit zkemkeeper), then restart the agent.",
                },
                ct);
            return;
        }

        if (path.Equals("/devices/status", StringComparison.OrdinalIgnoreCase) && ctx.Request.HttpMethod == "GET")
        {
            var probes = await _sync.ProbeAllDevicesAsync(ct);
            await WriteJsonAsync(
                ctx,
                200,
                new
                {
                    ok = true,
                    devices = probes.Select(p => new
                    {
                        id = p.Id,
                        name = p.Name,
                        ip = p.Ip,
                        connected = p.Connected,
                        message = p.Message,
                    }),
                },
                ct);
            return;
        }

        if (path.Equals("/devices/biometric-status", StringComparison.OrdinalIgnoreCase) && ctx.Request.HttpMethod == "GET")
        {
            var scans = await _sync.ScanBiometricEnrollmentsAsync(ct);
            await WriteJsonAsync(
                ctx,
                200,
                new
                {
                    ok = true,
                    scannedAt = DateTimeOffset.UtcNow,
                    devices = scans.Select(s => new
                    {
                        id = s.Id,
                        name = s.Name,
                        ip = s.Ip,
                        scanned = s.Scanned,
                        error = s.Error,
                        supportsFace = s.SupportsFace,
                        users = s.Users.Select(u => new
                        {
                            pin = u.Pin,
                            hasFinger = u.HasFinger,
                            hasFace = u.HasFace,
                        }),
                    }),
                },
                ct);
            return;
        }

        if (path.Equals("/sync/status", StringComparison.OrdinalIgnoreCase) && ctx.Request.HttpMethod == "GET")
        {
            await WriteJsonAsync(ctx, 200, _sync.GetProgress(), ct);
            return;
        }

        if (path.Equals("/sync/reset", StringComparison.OrdinalIgnoreCase) && ctx.Request.HttpMethod == "POST")
        {
            _sync.ResetSyncState();
            await WriteJsonAsync(ctx, 200, new { ok = true, message = "Sync cursor cleared. Next pull re-imports last 90 days." }, ct);
            return;
        }

        if (path.Equals("/sync", StringComparison.OrdinalIgnoreCase) && ctx.Request.HttpMethod == "POST")
        {
            if (!_agent.EnableHttpTrigger)
            {
                await WriteJsonAsync(ctx, 403, new { ok = false, error = "HTTP trigger disabled" }, ct);
                return;
            }

            var snapshot = _sync.GetProgress();
            if (snapshot.Running)
            {
                await WriteJsonAsync(ctx, 409, new { ok = false, started = false, alreadyRunning = true, progress = snapshot }, ct);
                return;
            }

            if (!_sync.StartBackgroundSync())
            {
                await WriteJsonAsync(ctx, 409, new { ok = false, started = false, alreadyRunning = true, progress = _sync.GetProgress() }, ct);
                return;
            }

            await WriteJsonAsync(ctx, 202, new { ok = true, started = true, progress = _sync.GetProgress() }, ct);
            return;
        }

        await WriteJsonAsync(
            ctx,
            404,
            new
            {
                ok = false,
                error = "Not found. Use POST /sync, GET /sync/status, GET /devices/status, GET /devices/biometric-status, or GET /health",
            },
            ct);
    }

    private static void AddCors(HttpListenerResponse response)
    {
        response.Headers.Add("Access-Control-Allow-Origin", "*");
        response.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        response.Headers.Add("Access-Control-Allow-Headers", "Content-Type");
    }

    private static async Task WriteJsonAsync(HttpListenerContext ctx, int status, object body, CancellationToken ct)
    {
        var json = JsonSerializer.Serialize(body, JsonOptions);
        var bytes = Encoding.UTF8.GetBytes(json);
        ctx.Response.StatusCode = status;
        ctx.Response.ContentType = "application/json";
        ctx.Response.ContentLength64 = bytes.Length;
        await ctx.Response.OutputStream.WriteAsync(bytes, ct);
        ctx.Response.Close();
    }
}
