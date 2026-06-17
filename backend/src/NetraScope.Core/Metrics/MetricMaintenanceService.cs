using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using NetraScope.Core.Data;
using NetraScope.Core.Entities;

namespace NetraScope.Core.Metrics;

public sealed class MetricMaintenanceService(
    NetraDbContext db,
    IOptions<MetricMaintenanceOptions> options,
    TimeProvider timeProvider) : IMetricMaintenanceService
{
    private MetricMaintenanceOptions Options => options.Value;

    public async Task RunOnceAsync(CancellationToken cancellationToken)
    {
        await RollUpAsync(cancellationToken);
        await PruneAsync(cancellationToken);
    }

    public async Task RollUpAsync(CancellationToken cancellationToken)
    {
        var now = timeProvider.GetUtcNow();
        await RollUpTierAsync(
            MetricResolution.FiveMinuteGranularity,
            MetricResolution.FiveMinuteSeconds,
            Options.FiveMinuteLookbackMinutes,
            now,
            cancellationToken);
        await RollUpTierAsync(
            MetricResolution.HourGranularity,
            MetricResolution.HourSeconds,
            Options.HourLookbackMinutes,
            now,
            cancellationToken);
    }

    public async Task PruneAsync(CancellationToken cancellationToken)
    {
        var now = timeProvider.GetUtcNow();
        var rawCutoff = now.AddDays(-Options.RawRetentionDays);
        var fiveMinuteCutoff = now.AddDays(-Options.FiveMinuteRetentionDays);
        var hourCutoff = now.AddDays(-Options.HourRetentionDays);

        if (db.Database.IsNpgsql())
        {
            await db.PerformanceMetrics
                .Where(metric => metric.Timestamp < rawCutoff)
                .ExecuteDeleteAsync(cancellationToken);
            await db.MetricRollups
                .Where(rollup => rollup.Granularity == MetricResolution.FiveMinuteGranularity
                    && rollup.BucketStart < fiveMinuteCutoff)
                .ExecuteDeleteAsync(cancellationToken);
            await db.MetricRollups
                .Where(rollup => rollup.Granularity == MetricResolution.HourGranularity
                    && rollup.BucketStart < hourCutoff)
                .ExecuteDeleteAsync(cancellationToken);
            return;
        }

        var expiredRaw = await db.PerformanceMetrics
            .Where(metric => metric.Timestamp < rawCutoff)
            .ToListAsync(cancellationToken);
        db.PerformanceMetrics.RemoveRange(expiredRaw);

        var expiredRollups = await db.MetricRollups
            .Where(rollup =>
                (rollup.Granularity == MetricResolution.FiveMinuteGranularity
                    && rollup.BucketStart < fiveMinuteCutoff)
                || (rollup.Granularity == MetricResolution.HourGranularity
                    && rollup.BucketStart < hourCutoff))
            .ToListAsync(cancellationToken);
        db.MetricRollups.RemoveRange(expiredRollups);

        await db.SaveChangesAsync(cancellationToken);
    }

    private async Task RollUpTierAsync(
        string granularity,
        int bucketSeconds,
        int lookbackMinutes,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var sinceBucket = Truncate(now.AddMinutes(-lookbackMinutes), bucketSeconds);

        var samples = await db.PerformanceMetrics
            .AsNoTracking()
            .Where(metric => metric.Timestamp >= sinceBucket)
            .ToListAsync(cancellationToken);
        if (samples.Count == 0)
        {
            return;
        }

        var existing = await db.MetricRollups
            .Where(rollup => rollup.Granularity == granularity && rollup.BucketStart >= sinceBucket)
            .ToListAsync(cancellationToken);
        var existingByKey = existing.ToDictionary(rollup => (rollup.ServerId, rollup.BucketStart));

        var groups = samples.GroupBy(metric =>
            (metric.ServerId, BucketStart: Truncate(metric.Timestamp, bucketSeconds)));

        foreach (var group in groups)
        {
            var key = (group.Key.ServerId, group.Key.BucketStart);
            if (!existingByKey.TryGetValue(key, out var rollup))
            {
                rollup = new MetricRollup
                {
                    Granularity = granularity,
                    ServerId = group.Key.ServerId,
                    BucketStart = group.Key.BucketStart,
                };
                db.MetricRollups.Add(rollup);
            }

            rollup.CpuAvgPct = (float)group.Average(metric => metric.CpuUsagePct);
            rollup.CpuMaxPct = group.Max(metric => metric.CpuUsagePct);
            rollup.MemoryUsedAvgBytes = (long)group.Average(metric => metric.MemoryUsedBytes);
            rollup.MemoryUsedMaxBytes = group.Max(metric => metric.MemoryUsedBytes);
            rollup.MemoryTotalMaxBytes = group.Max(metric => metric.MemoryTotalBytes);
            rollup.DiskAvgPct = (float)group.Average(metric => metric.DiskUtilizationPct);
            rollup.DiskMaxPct = group.Max(metric => metric.DiskUtilizationPct);
            rollup.NetworkInAvgBytesSec = (long)group.Average(metric => metric.NetworkInBytesSec);
            rollup.NetworkInMaxBytesSec = group.Max(metric => metric.NetworkInBytesSec);
            rollup.SampleCount = group.Count();
        }

        await db.SaveChangesAsync(cancellationToken);
    }

    private static DateTimeOffset Truncate(DateTimeOffset timestamp, int bucketSeconds)
    {
        var epoch = timestamp.ToUniversalTime().ToUnixTimeSeconds();
        return DateTimeOffset.FromUnixTimeSeconds(epoch - (epoch % bucketSeconds));
    }
}
