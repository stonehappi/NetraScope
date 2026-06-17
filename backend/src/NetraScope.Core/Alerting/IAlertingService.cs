using NetraScope.Shared;

namespace NetraScope.Core.Alerting;

public interface IAlertingService
{
    Task EvaluateMetricAsync(
        MetricPacket packet,
        Guid ownerUserId,
        CancellationToken cancellationToken);

    Task EvaluateOfflineServersAsync(CancellationToken cancellationToken);
}
