using Hrm.ZktAgent.Options;
using Hrm.ZktAgent.Services;
using Hrm.ZktAgent.Worker;
using Serilog;

Log.Logger = new LoggerConfiguration()
    .WriteTo.Console()
    .CreateBootstrapLogger();

try
{
    var builder = Host.CreateApplicationBuilder(args);
    builder.Configuration.AddJsonFile("appsettings.Local.json", optional: true, reloadOnChange: true);

    builder.Services.AddSerilog((_, cfg) => cfg.ReadFrom.Configuration(builder.Configuration));

    builder.Services.Configure<AgentOptions>(builder.Configuration.GetSection(AgentOptions.SectionName));
    builder.Services.Configure<SupabaseOptions>(builder.Configuration.GetSection(SupabaseOptions.SectionName));

    builder.Services.AddHttpClient<SupabaseHrmClient>();
    builder.Services.AddSingleton<ZkEmKeeperClient>();
    builder.Services.AddSingleton<SyncStateStore>();
    builder.Services.AddSingleton<SyncProgressStore>();
    builder.Services.AddSingleton<AgentCycleStatusStore>();
    builder.Services.AddSingleton<AttendanceSyncService>();
    builder.Services.AddHostedService<AttendanceSyncWorker>();
    builder.Services.AddHostedService<AgentHttpTriggerService>();

    var host = builder.Build();
    await host.RunAsync();
}
catch (Exception ex)
{
    Log.Fatal(ex, "Agent terminated unexpectedly");
    throw;
}
finally
{
    await Log.CloseAndFlushAsync();
}
