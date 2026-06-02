using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Hrm.ZktAgent.Models;
using Hrm.ZktAgent.Options;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Hrm.ZktAgent.Services;

public sealed class SupabaseHrmClient
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly HttpClient _http;
    private readonly SupabaseOptions _options;
    private readonly ILogger<SupabaseHrmClient> _logger;

    public SupabaseHrmClient(HttpClient http, IOptions<SupabaseOptions> options, ILogger<SupabaseHrmClient> logger)
    {
        _http = http;
        _options = options.Value;
        _logger = logger;
    }

    public void EnsureConfigured()
    {
        if (string.IsNullOrWhiteSpace(_options.Url) || string.IsNullOrWhiteSpace(_options.ServiceRoleKey))
        {
            throw new InvalidOperationException("Set Supabase:Url and Supabase:ServiceRoleKey in appsettings.json or environment variables.");
        }
    }

    public async Task<IReadOnlyList<HrmDevice>> GetPullableDevicesAsync(CancellationToken ct)
    {
        var url =
            $"{BaseUrl()}/rest/v1/attendance_devices?device_type=eq.ZKTeco&is_active=eq.true&ip_address=not.is.null&select=id,company_id,name,serial_no,ip_address,is_active,agent_last_sync_at";
        using var req = CreateRequest(HttpMethod.Get, url);
        using var res = await _http.SendAsync(req, ct);
        res.EnsureSuccessStatusCode();
        var json = await res.Content.ReadAsStringAsync(ct);
        var rows = JsonSerializer.Deserialize<List<DeviceRow>>(json, JsonOpts) ?? [];
        return rows.Select(r => new HrmDevice(
            r.Id,
            r.CompanyId,
            r.Name,
            r.SerialNo,
            r.IpAddress,
            r.IsActive,
            ParseAgentSyncTime(r.AgentLastSyncAt))).ToList();
    }

    /// <summary>Per-device PIN map; falls back to company-wide employees.device_pin if no rows exist for this device.</summary>
    public async Task<IReadOnlyDictionary<int, Guid>> GetEmployeePinsForDeviceAsync(
        Guid deviceId,
        Guid companyId,
        CancellationToken ct)
    {
        var url = $"{BaseUrl()}/rest/v1/employee_device_pins?device_id=eq.{deviceId}&select=employee_id,device_pin";
        using var req = CreateRequest(HttpMethod.Get, url);
        using var res = await _http.SendAsync(req, ct);
        if (res.IsSuccessStatusCode)
        {
            var json = await res.Content.ReadAsStringAsync(ct);
            var rows = JsonSerializer.Deserialize<List<DevicePinRow>>(json, JsonOpts) ?? [];
            var map = new Dictionary<int, Guid>();
            foreach (var row in rows)
            {
                if (row.DevicePin is > 0)
                {
                    map[row.DevicePin.Value] = row.EmployeeId;
                }
            }

            if (map.Count > 0)
            {
                return map;
            }
        }
        else if (res.StatusCode != System.Net.HttpStatusCode.NotFound)
        {
            res.EnsureSuccessStatusCode();
        }

        var fromSettings = await GetEmployeePinsFromAppSettingsAsync(deviceId, companyId, ct);
        if (fromSettings.Count > 0)
        {
            return fromSettings;
        }

        return await GetEmployeePinsAsync(companyId, ct);
    }

    private async Task<IReadOnlyDictionary<int, Guid>> GetEmployeePinsFromAppSettingsAsync(
        Guid deviceId,
        Guid companyId,
        CancellationToken ct)
    {
        var url = $"{BaseUrl()}/rest/v1/app_settings?company_id=eq.{companyId}&select=settings";
        using var req = CreateRequest(HttpMethod.Get, url);
        using var res = await _http.SendAsync(req, ct);
        if (!res.IsSuccessStatusCode) return new Dictionary<int, Guid>();

        var json = await res.Content.ReadAsStringAsync(ct);
        var rows = JsonSerializer.Deserialize<List<AppSettingsRow>>(json, JsonOpts) ?? [];
        var settings = rows.FirstOrDefault()?.Settings;
        if (settings is not JsonElement el || el.ValueKind != JsonValueKind.Object) return new Dictionary<int, Guid>();

        if (!el.TryGetProperty("zkt_device_pin_map", out var mapEl) || mapEl.ValueKind != JsonValueKind.Array)
        {
            return new Dictionary<int, Guid>();
        }

        var map = new Dictionary<int, Guid>();
        foreach (var item in mapEl.EnumerateArray())
        {
            if (!item.TryGetProperty("device_id", out var devEl) ||
                !item.TryGetProperty("device_pin", out var pinEl) ||
                !item.TryGetProperty("employee_id", out var empEl))
            {
                continue;
            }

            if (!Guid.TryParse(devEl.GetString(), out var devGuid) || devGuid != deviceId) continue;
            if (!Guid.TryParse(empEl.GetString(), out var empGuid)) continue;
            if (pinEl.TryGetInt32(out var pin) && pin > 0) map[pin] = empGuid;
        }

        return map;
    }

    public async Task<IReadOnlyDictionary<int, Guid>> GetEmployeePinsAsync(Guid companyId, CancellationToken ct)
    {
        var url =
            $"{BaseUrl()}/rest/v1/employees?company_id=eq.{companyId}&is_active=eq.true&device_pin=not.is.null&select=id,device_pin";
        using var req = CreateRequest(HttpMethod.Get, url);
        using var res = await _http.SendAsync(req, ct);
        res.EnsureSuccessStatusCode();
        var json = await res.Content.ReadAsStringAsync(ct);
        var rows = JsonSerializer.Deserialize<List<EmployeeRow>>(json, JsonOpts) ?? [];
        var map = new Dictionary<int, Guid>();
        foreach (var row in rows)
        {
            if (row.DevicePin is > 0)
            {
                map[row.DevicePin.Value] = row.Id;
            }
        }
        return map;
    }

    public async Task<int> InsertPunchesAsync(IReadOnlyList<PunchInsert> punches, CancellationToken ct)
    {
        if (punches.Count == 0) return 0;

        var url = $"{BaseUrl()}/rest/v1/attendance_punches";
        using var req = CreateRequest(HttpMethod.Post, url);
        req.Headers.Add("Prefer", "resolution=ignore-duplicates,return=minimal");
        req.Content = new StringContent(JsonSerializer.Serialize(punches, JsonOpts), Encoding.UTF8, "application/json");

        using var res = await _http.SendAsync(req, ct);
        if (res.IsSuccessStatusCode) return punches.Count;

        var body = await res.Content.ReadAsStringAsync(ct);
        if (res.StatusCode == System.Net.HttpStatusCode.Conflict || body.Contains("23505", StringComparison.Ordinal))
        {
            _logger.LogWarning("Some punches were duplicates and skipped.");
            return 0;
        }

        res.EnsureSuccessStatusCode();
        return punches.Count;
    }

    public async Task RecomputeAsync(Guid employeeId, DateOnly date, CancellationToken ct)
    {
        var url = $"{BaseUrl()}/rest/v1/rpc/recompute_attendance_for_employee";
        var payload = JsonSerializer.Serialize(new { p_employee_id = employeeId, p_date = date.ToString("yyyy-MM-dd") });
        using var req = CreateRequest(HttpMethod.Post, url);
        req.Content = new StringContent(payload, Encoding.UTF8, "application/json");
        using var res = await _http.SendAsync(req, ct);
        if (!res.IsSuccessStatusCode)
        {
            var body = await res.Content.ReadAsStringAsync(ct);
            _logger.LogWarning("Recompute failed for {Employee} {Date}: {Body}", employeeId, date, body);
        }
    }

    public async Task UpdateDeviceSyncStatusAsync(Guid deviceId, string? notes, CancellationToken ct)
    {
        var url = $"{BaseUrl()}/rest/v1/attendance_devices?id=eq.{deviceId}";
        var payload = JsonSerializer.Serialize(new
        {
            agent_last_sync_at = DateTimeOffset.UtcNow,
            last_seen_at = DateTimeOffset.UtcNow,
            agent_sync_notes = notes,
        }, JsonOpts);
        using var req = CreateRequest(HttpMethod.Patch, url);
        req.Content = new StringContent(payload, Encoding.UTF8, "application/json");
        using var res = await _http.SendAsync(req, ct);
        res.EnsureSuccessStatusCode();
    }

    public async Task UpdateDeviceLanStatusAsync(
        Guid deviceId,
        bool connected,
        string message,
        CancellationToken ct)
    {
        var url = $"{BaseUrl()}/rest/v1/attendance_devices?id=eq.{deviceId}";
        var body = new Dictionary<string, object?>
        {
            ["agent_connect_ok"] = connected,
            ["agent_connect_checked_at"] = DateTimeOffset.UtcNow,
            ["agent_lan_message"] = message,
        };
        if (connected)
        {
            body["last_seen_at"] = DateTimeOffset.UtcNow;
        }

        if (await PatchDeviceAsync(url, body, ct))
        {
            return;
        }

        // Without agent_lan_message column — still update connect flags
        var fallback = new Dictionary<string, object?>
        {
            ["agent_connect_ok"] = connected,
            ["agent_connect_checked_at"] = DateTimeOffset.UtcNow,
        };
        if (connected)
        {
            fallback["last_seen_at"] = DateTimeOffset.UtcNow;
        }

        await PatchDeviceAsync(url, fallback, ct);
    }

    public async Task UpsertAgentHeartbeatAsync(
        Guid companyId,
        bool isSyncing,
        string? cycleSummary,
        int devicesOnline,
        int devicesTotal,
        CancellationToken ct)
    {
        var url = $"{BaseUrl()}/rest/v1/zkt_agent_heartbeat?on_conflict=company_id";
        var payload = JsonSerializer.Serialize(new
        {
            company_id = companyId,
            last_seen_at = DateTimeOffset.UtcNow,
            host_name = Environment.MachineName,
            is_syncing = isSyncing,
            cycle_summary = cycleSummary,
            devices_online = devicesOnline,
            devices_total = devicesTotal,
            updated_at = DateTimeOffset.UtcNow,
        }, JsonOpts);

        using var req = CreateRequest(HttpMethod.Post, url);
        req.Headers.TryAddWithoutValidation("Prefer", "resolution=merge-duplicates");
        req.Content = new StringContent(payload, Encoding.UTF8, "application/json");
        using var res = await _http.SendAsync(req, ct);
        if (!res.IsSuccessStatusCode)
        {
            var body = await res.Content.ReadAsStringAsync(ct);
            _logger.LogDebug("Agent heartbeat upsert skipped ({Status}): {Body}", res.StatusCode, body);
        }
    }

    public async Task UpdateDeviceConnectStatusAsync(
        Guid deviceId,
        bool connected,
        string? notes,
        CancellationToken ct,
        bool writeSyncNotes = false)
    {
        var url = $"{BaseUrl()}/rest/v1/attendance_devices?id=eq.{deviceId}";
        var body = new Dictionary<string, object?>
        {
            ["agent_connect_ok"] = connected,
            ["agent_connect_checked_at"] = DateTimeOffset.UtcNow,
        };
        if (connected)
        {
            body["last_seen_at"] = DateTimeOffset.UtcNow;
        }
        // LAN probes must not overwrite last sync error text in agent_sync_notes.
        if (writeSyncNotes && !string.IsNullOrWhiteSpace(notes))
        {
            body["agent_sync_notes"] = notes;
        }

        if (await PatchDeviceAsync(url, body, ct))
        {
            return;
        }

        // Supabase without APPLY_PENDING_DEVICES.sql — still update sync notes / last seen
        var fallback = new Dictionary<string, object?>();
        if (connected)
        {
            fallback["last_seen_at"] = DateTimeOffset.UtcNow;
        }
        if (!string.IsNullOrWhiteSpace(notes))
        {
            fallback["agent_sync_notes"] = notes;
        }
        if (fallback.Count > 0)
        {
            await PatchDeviceAsync(url, fallback, ct);
        }
    }

    private async Task<bool> PatchDeviceAsync(string url, Dictionary<string, object?> body, CancellationToken ct)
    {
        var payload = JsonSerializer.Serialize(body, JsonOpts);
        using var req = CreateRequest(HttpMethod.Patch, url);
        req.Content = new StringContent(payload, Encoding.UTF8, "application/json");
        using var res = await _http.SendAsync(req, ct);
        if (res.IsSuccessStatusCode)
        {
            return true;
        }

        var errorBody = await res.Content.ReadAsStringAsync(ct);
        _logger.LogWarning("Device PATCH failed ({Status}): {Body}", res.StatusCode, errorBody);
        return false;
    }

    private static DateTimeOffset? ParseAgentSyncTime(DateTime? value)
    {
        if (!value.HasValue) return null;
        return new DateTimeOffset(value.Value.ToUniversalTime(), TimeSpan.Zero);
    }

    private string BaseUrl() => _options.Url.TrimEnd('/');

    private HttpRequestMessage CreateRequest(HttpMethod method, string url)
    {
        var req = new HttpRequestMessage(method, url);
        req.Headers.Add("apikey", _options.ServiceRoleKey);
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _options.ServiceRoleKey);
        return req;
    }

    private sealed class DeviceRow
    {
        public Guid Id { get; set; }
        public Guid CompanyId { get; set; }
        public string Name { get; set; } = "";
        public string? SerialNo { get; set; }
        public string? IpAddress { get; set; }
        public bool IsActive { get; set; }
        public DateTime? AgentLastSyncAt { get; set; }
    }

    private sealed class EmployeeRow
    {
        public Guid Id { get; set; }
        public int? DevicePin { get; set; }
    }

    private sealed class DevicePinRow
    {
        public Guid EmployeeId { get; set; }
        public int? DevicePin { get; set; }
    }

    private sealed class AppSettingsRow
    {
        public JsonElement? Settings { get; set; }
    }
}

public sealed record PunchInsert(
    Guid CompanyId,
    Guid EmployeeId,
    Guid? DeviceId,
    DateTime PunchAt,
    string PunchType,
    string Source,
    JsonElement? RawPayload
);
