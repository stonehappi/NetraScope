using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using NetraScope.Core.Alerting;
using NetraScope.Core.Data;
using NetraScope.Core.Entities;
using NetraScope.Shared;
using Xunit;

namespace NetraScope.Core.Tests;

public sealed class AlertingServiceTests
{
    private static readonly Guid TestOwnerUserId = Guid.NewGuid();

    [Fact]
    public async Task HighMemoryCreatesAndResolvesAlert()
    {
        await using var db = CreateDbContext();
        AddServer(db, "server-memory");
        await db.SaveChangesAsync();
        var notifier = new CapturingNotifier();
        var service = CreateService(db, notifier);

        await service.EvaluateMetricAsync(
            ValidPacket("server-memory") with
            {
                MemoryUsedBytes = 950,
                MemoryTotalBytes = 1000,
            },
            TestOwnerUserId,
            CancellationToken.None);

        var active = await db.AlertEvents.SingleAsync();
        Assert.Equal("memory_high", active.RuleKey);
        Assert.Equal("active", active.Status);
        Assert.Single(notifier.Notifications);

        await service.EvaluateMetricAsync(
            ValidPacket("server-memory") with
            {
                MemoryUsedBytes = 500,
                MemoryTotalBytes = 1000,
                Timestamp = DateTimeOffset.UtcNow.AddMinutes(1),
            },
            TestOwnerUserId,
            CancellationToken.None);

        Assert.Equal("resolved", (await db.AlertEvents.SingleAsync()).Status);
        Assert.Equal(2, notifier.Notifications.Count);
    }

    [Fact]
    public async Task CpuAlertRequiresSustainedHighWindow()
    {
        await using var db = CreateDbContext();
        var now = DateTimeOffset.UtcNow;
        AddServer(db, "server-cpu");
        db.PerformanceMetrics.AddRange(
            NewMetric("server-cpu", now.AddMinutes(-5), 95),
            NewMetric("server-cpu", now.AddMinutes(-4), 94),
            NewMetric("server-cpu", now, 93));
        await db.SaveChangesAsync();
        var service = CreateService(db, new CapturingNotifier());

        await service.EvaluateMetricAsync(
            ValidPacket("server-cpu") with
            {
                Timestamp = now,
                CpuUsagePct = 93,
            },
            TestOwnerUserId,
            CancellationToken.None);

        var alert = await db.AlertEvents.SingleAsync(alert => alert.RuleKey == "cpu_high_5m");
        Assert.Equal("active", alert.Status);
    }

    [Fact]
    public async Task OfflineAlertCreatesAndHeartbeatResolves()
    {
        var now = DateTimeOffset.UtcNow;
        await using var db = CreateDbContext();
        AddServer(db, "server-offline", lastHeartbeatAt: now.AddMinutes(-3));
        await db.SaveChangesAsync();
        var notifier = new CapturingNotifier();
        var service = CreateService(db, notifier, now);

        await service.EvaluateOfflineServersAsync(CancellationToken.None);

        var alert = await db.AlertEvents.SingleAsync();
        Assert.Equal("server_offline", alert.RuleKey);
        Assert.Equal("active", alert.Status);

        await service.EvaluateMetricAsync(
            ValidPacket("server-offline") with { Timestamp = now.AddMinutes(1) },
            TestOwnerUserId,
            CancellationToken.None);

        Assert.Equal("resolved", (await db.AlertEvents.SingleAsync()).Status);
        Assert.Equal(2, notifier.Notifications.Count);
    }

    private static AlertingService CreateService(
        NetraDbContext db,
        CapturingNotifier notifier,
        DateTimeOffset? now = null) =>
        new(
            db,
            notifier,
            Options.Create(new AlertingOptions()),
            new FixedTimeProvider(now ?? DateTimeOffset.UtcNow));

    private static NetraDbContext CreateDbContext()
    {
        var options = new DbContextOptionsBuilder<NetraDbContext>()
            .UseInMemoryDatabase($"netrascope-alert-tests-{Guid.NewGuid()}")
            .Options;

        return new NetraDbContext(options);
    }

    private static void AddServer(
        NetraDbContext db,
        string serverId,
        DateTimeOffset? lastHeartbeatAt = null)
    {
        db.Servers.Add(new Server
        {
            Id = serverId,
            HostName = serverId,
            LastHeartbeatAt = lastHeartbeatAt ?? DateTimeOffset.UtcNow,
            OwnerUserId = TestOwnerUserId,
        });
    }

    private static PerformanceMetric NewMetric(
        string serverId,
        DateTimeOffset timestamp,
        float cpu) => new()
    {
        ServerId = serverId,
        Timestamp = timestamp,
        CpuUsagePct = cpu,
        MemoryUsedBytes = 512,
        MemoryTotalBytes = 1024,
        DiskUtilizationPct = 40,
        NetworkInBytesSec = 2048,
    };

    private static MetricPacket ValidPacket(string serverId) => new(
        ServerId: serverId,
        Timestamp: DateTimeOffset.UtcNow,
        CpuUsagePct: 25,
        MemoryUsedBytes: 512,
        MemoryTotalBytes: 1024,
        DiskUtilizationPct: 40,
        NetworkInBytesSec: 2048);

    private sealed class CapturingNotifier : IAlertNotifier
    {
        public List<AlertNotification> Notifications { get; } = [];

        public Task NotifyAsync(
            AlertNotification notification,
            CancellationToken cancellationToken)
        {
            Notifications.Add(notification);
            return Task.CompletedTask;
        }
    }

    private sealed class FixedTimeProvider(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
