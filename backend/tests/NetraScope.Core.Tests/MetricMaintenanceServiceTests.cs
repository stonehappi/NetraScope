using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using NetraScope.Core.Data;
using NetraScope.Core.Entities;
using NetraScope.Core.Metrics;
using Xunit;

namespace NetraScope.Core.Tests;

public sealed class MetricMaintenanceServiceTests
{
    private static readonly DateTimeOffset Now =
        new(2026, 6, 17, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task RollUpAggregatesRawSamplesIntoBuckets()
    {
        await using var db = CreateDbContext();
        AddServer(db, "server-01");
        // Two samples in the same 5-minute and hourly bucket (11:55 / 11:00).
        db.PerformanceMetrics.Add(NewMetric("server-01", Now.AddMinutes(-5), cpu: 20, disk: 30));
        db.PerformanceMetrics.Add(NewMetric("server-01", Now.AddMinutes(-5).AddSeconds(30), cpu: 40, disk: 50));
        await db.SaveChangesAsync();

        await CreateService(db).RollUpAsync(CancellationToken.None);

        var fiveMinute = await db.MetricRollups.SingleAsync(
            rollup => rollup.Granularity == MetricResolution.FiveMinuteGranularity);
        Assert.Equal(new DateTimeOffset(2026, 6, 17, 11, 55, 0, TimeSpan.Zero), fiveMinute.BucketStart);
        Assert.Equal(30, fiveMinute.CpuAvgPct);
        Assert.Equal(40, fiveMinute.CpuMaxPct);
        Assert.Equal(40, fiveMinute.DiskAvgPct);
        Assert.Equal(50, fiveMinute.DiskMaxPct);
        Assert.Equal(1024, fiveMinute.MemoryTotalMaxBytes);
        Assert.Equal(2, fiveMinute.SampleCount);

        var hour = await db.MetricRollups.SingleAsync(
            rollup => rollup.Granularity == MetricResolution.HourGranularity);
        Assert.Equal(new DateTimeOffset(2026, 6, 17, 11, 0, 0, TimeSpan.Zero), hour.BucketStart);
        Assert.Equal(30, hour.CpuAvgPct);
        Assert.Equal(2, hour.SampleCount);
    }

    [Fact]
    public async Task RollUpIsIdempotentAndUpdatesExistingBuckets()
    {
        await using var db = CreateDbContext();
        AddServer(db, "server-01");
        db.PerformanceMetrics.Add(NewMetric("server-01", Now.AddMinutes(-5), cpu: 20));
        await db.SaveChangesAsync();

        var service = CreateService(db);
        await service.RollUpAsync(CancellationToken.None);

        // A late sample lands in the same bucket; a second pass must not duplicate.
        db.PerformanceMetrics.Add(NewMetric("server-01", Now.AddMinutes(-5).AddSeconds(10), cpu: 60));
        await db.SaveChangesAsync();
        await service.RollUpAsync(CancellationToken.None);

        var rollup = await db.MetricRollups.SingleAsync(
            r => r.Granularity == MetricResolution.FiveMinuteGranularity);
        Assert.Equal(40, rollup.CpuAvgPct);
        Assert.Equal(2, rollup.SampleCount);
    }

    [Fact]
    public async Task PruneDeletesDataPastRetentionWindows()
    {
        await using var db = CreateDbContext();
        AddServer(db, "server-01");
        db.PerformanceMetrics.Add(NewMetric("server-01", Now.AddDays(-31), cpu: 10)); // expired raw
        db.PerformanceMetrics.Add(NewMetric("server-01", Now.AddDays(-1), cpu: 10)); // kept raw
        db.MetricRollups.Add(NewRollup("server-01", MetricResolution.FiveMinuteGranularity, Now.AddDays(-100)));
        db.MetricRollups.Add(NewRollup("server-01", MetricResolution.FiveMinuteGranularity, Now.AddDays(-1)));
        db.MetricRollups.Add(NewRollup("server-01", MetricResolution.HourGranularity, Now.AddDays(-400)));
        db.MetricRollups.Add(NewRollup("server-01", MetricResolution.HourGranularity, Now.AddDays(-100)));
        await db.SaveChangesAsync();

        await CreateService(db).PruneAsync(CancellationToken.None);

        Assert.Equal(1, await db.PerformanceMetrics.CountAsync());
        Assert.Equal(
            1,
            await db.MetricRollups.CountAsync(
                r => r.Granularity == MetricResolution.FiveMinuteGranularity));
        Assert.Equal(
            1,
            await db.MetricRollups.CountAsync(
                r => r.Granularity == MetricResolution.HourGranularity));
    }

    private static MetricMaintenanceService CreateService(NetraDbContext db) =>
        new(
            db,
            Options.Create(new MetricMaintenanceOptions()),
            new FixedTimeProvider(Now));

    private static NetraDbContext CreateDbContext()
    {
        var options = new DbContextOptionsBuilder<NetraDbContext>()
            .UseInMemoryDatabase($"netrascope-maintenance-tests-{Guid.NewGuid()}")
            .Options;
        return new NetraDbContext(options);
    }

    private static void AddServer(NetraDbContext db, string serverId) =>
        db.Servers.Add(new Server
        {
            Id = serverId,
            HostName = serverId,
            LastHeartbeatAt = Now,
            OwnerUserId = Guid.NewGuid(),
        });

    private static PerformanceMetric NewMetric(
        string serverId,
        DateTimeOffset timestamp,
        float cpu,
        float disk = 40) => new()
    {
        ServerId = serverId,
        Timestamp = timestamp,
        CpuUsagePct = cpu,
        MemoryUsedBytes = 512,
        MemoryTotalBytes = 1024,
        DiskUtilizationPct = disk,
        NetworkInBytesSec = 2048,
    };

    private static MetricRollup NewRollup(
        string serverId,
        string granularity,
        DateTimeOffset bucketStart) => new()
    {
        ServerId = serverId,
        Granularity = granularity,
        BucketStart = bucketStart,
        SampleCount = 1,
        MemoryTotalMaxBytes = 1024,
    };

    private sealed class FixedTimeProvider(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
