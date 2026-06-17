namespace NetraScope.Core.Metrics;

public interface IMetricMaintenanceService
{
    /// <summary>Recomputes recent rollups, then prunes expired raw and rollup data.</summary>
    Task RunOnceAsync(CancellationToken cancellationToken);

    /// <summary>Recomputes 5-minute and hourly rollups from recent raw samples.</summary>
    Task RollUpAsync(CancellationToken cancellationToken);

    /// <summary>Deletes raw samples and rollups older than their retention windows.</summary>
    Task PruneAsync(CancellationToken cancellationToken);
}
