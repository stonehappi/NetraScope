using Microsoft.Extensions.Options;

namespace NetraScope.Core.Alerting;

public sealed class OfflineAlertWorker(
    IServiceScopeFactory scopeFactory,
    IOptions<AlertingOptions> options,
    ILogger<OfflineAlertWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (options.Value.Enabled)
                {
                    await using var scope = scopeFactory.CreateAsyncScope();
                    var alerting = scope.ServiceProvider.GetRequiredService<IAlertingService>();
                    await alerting.EvaluateOfflineServersAsync(stoppingToken);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Offline alert evaluation failed");
            }

            await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken);
        }
    }
}
