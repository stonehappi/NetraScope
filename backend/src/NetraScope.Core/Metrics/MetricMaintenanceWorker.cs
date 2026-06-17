using Microsoft.Extensions.Options;

namespace NetraScope.Core.Metrics;

/// <summary>
/// Periodically rolls up raw metrics into 5-minute and hourly aggregates and
/// prunes data past its retention window, keeping storage bounded.
/// </summary>
public sealed class MetricMaintenanceWorker(
    IServiceScopeFactory scopeFactory,
    IOptions<MetricMaintenanceOptions> options,
    ILogger<MetricMaintenanceWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var interval = TimeSpan.FromMinutes(Math.Max(1, options.Value.IntervalMinutes));
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (options.Value.Enabled)
                {
                    await using var scope = scopeFactory.CreateAsyncScope();
                    var maintenance = scope.ServiceProvider
                        .GetRequiredService<IMetricMaintenanceService>();
                    await maintenance.RunOnceAsync(stoppingToken);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Metric retention maintenance failed");
            }

            await Task.Delay(interval, stoppingToken);
        }
    }
}
