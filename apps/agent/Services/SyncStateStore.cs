using System.Text.Json;
using Hrm.ZktAgent.Models;
using Hrm.ZktAgent.Options;
using Microsoft.Extensions.Options;

namespace Hrm.ZktAgent.Services;

public sealed class SyncStateStore
{
    private readonly string _dir;

    public SyncStateStore(IOptions<AgentOptions> options)
    {
        _dir = string.IsNullOrWhiteSpace(options.Value.StateDirectory)
            ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "HrmZktAgent", "state")
            : options.Value.StateDirectory;
        Directory.CreateDirectory(_dir);
    }

    public DeviceSyncState Load(Guid deviceId)
    {
        var path = PathFor(deviceId);
        if (!File.Exists(path)) return new DeviceSyncState();
        try
        {
            var json = File.ReadAllText(path);
            return JsonSerializer.Deserialize<DeviceSyncState>(json) ?? new DeviceSyncState();
        }
        catch
        {
            return new DeviceSyncState();
        }
    }

    public void Save(Guid deviceId, DeviceSyncState state)
    {
        state.LastRunUtc = DateTimeOffset.UtcNow;
        var path = PathFor(deviceId);
        File.WriteAllText(path, JsonSerializer.Serialize(state, new JsonSerializerOptions { WriteIndented = true }));
    }

    /// <summary>Clears sync cursor so the next pull re-imports within InitialLookbackDays.</summary>
    public void Clear(Guid? deviceId = null)
    {
        if (deviceId.HasValue)
        {
            var path = PathFor(deviceId.Value);
            if (File.Exists(path))
            {
                File.Delete(path);
            }
            return;
        }

        if (!Directory.Exists(_dir))
        {
            return;
        }

        foreach (var file in Directory.GetFiles(_dir, "*.json"))
        {
            File.Delete(file);
        }
    }

    private string PathFor(Guid deviceId) => Path.Combine(_dir, $"{deviceId:N}.json");
}
