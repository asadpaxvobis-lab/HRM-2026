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
