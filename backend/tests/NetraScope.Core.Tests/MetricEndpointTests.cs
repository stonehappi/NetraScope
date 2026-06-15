using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using NetraScope.Core.Auth;
using NetraScope.Core.Contracts;
using NetraScope.Core.Data;
using NetraScope.Core.Endpoints;
using NetraScope.Core.Entities;
using NetraScope.Shared;
using Xunit;

namespace NetraScope.Core.Tests;

public sealed class MetricEndpointTests
{
    private static readonly Guid TestOwnerUserId = Guid.NewGuid();

    [Fact]
    public async Task PostMetricCreatesServerAndMetric()
    {
        await using var db = CreateDbContext();
        var packet = ValidPacket() with { ServerId = "server-01" };

        var result = await IngestAsync(packet, db);

        Assert.Equal((int)HttpStatusCode.Accepted, GetStatusCode(result));

        var server = await db.Servers.SingleAsync(item => item.Id == packet.ServerId);
        var metric = await db.PerformanceMetrics.SingleAsync(
            item => item.ServerId == packet.ServerId);

        Assert.Equal(packet.ServerId, server.HostName);
        Assert.Equal(TestOwnerUserId, server.OwnerUserId);
        Assert.Equal(packet.CpuUsagePct, metric.CpuUsagePct);
        Assert.Equal(packet.MemoryUsedBytes, metric.MemoryUsedBytes);
    }

    [Fact]
    public async Task PostMetricUpdatesExistingHeartbeat()
    {
        await using var db = CreateDbContext();
        var packet = ValidPacket() with { ServerId = "server-02" };

        var firstResult = await IngestAsync(packet, db);
        Assert.Equal((int)HttpStatusCode.Accepted, GetStatusCode(firstResult));

        await Task.Delay(10);
        var secondResult = await IngestAsync(packet with { CpuUsagePct = 55 }, db);
        Assert.Equal((int)HttpStatusCode.Accepted, GetStatusCode(secondResult));

        Assert.Equal(1, await db.Servers.CountAsync(item => item.Id == packet.ServerId));
        Assert.Equal(2, await db.PerformanceMetrics.CountAsync(
            item => item.ServerId == packet.ServerId));
    }

    [Fact]
    public async Task PostMetricRejectsInvalidValues()
    {
        await using var db = CreateDbContext();
        var packet = ValidPacket() with
        {
            ServerId = "",
            CpuUsagePct = 101,
            MemoryUsedBytes = 2048,
            MemoryTotalBytes = 1024,
        };

        var result = await IngestAsync(packet, db);

        Assert.Equal((int)HttpStatusCode.BadRequest, GetStatusCode(result));
        Assert.Empty(db.PerformanceMetrics);
    }

    [Fact]
    public async Task PostMetricRejectsServerOwnedByAnotherUser()
    {
        await using var db = CreateDbContext();
        var existingOwnerId = Guid.NewGuid();
        db.Servers.Add(new Server
        {
            Id = "shared-server-id",
            HostName = "shared-server-id",
            LastHeartbeatAt = DateTimeOffset.UtcNow.AddMinutes(-5),
            OwnerUserId = existingOwnerId,
        });
        await db.SaveChangesAsync();

        var result = await IngestAsync(
            ValidPacket() with { ServerId = "shared-server-id" },
            db,
            ownerUserId: Guid.NewGuid());

        Assert.Equal((int)HttpStatusCode.Conflict, GetStatusCode(result));
        Assert.Empty(db.PerformanceMetrics);
        Assert.Equal(existingOwnerId, (await db.Servers.SingleAsync()).OwnerUserId);
    }

    [Fact]
    public void GoAgentPayloadMatchesSharedContract()
    {
        const string payload =
            """
            {
              "serverId": "server-03",
              "timestamp": "2026-06-13T05:00:00Z",
              "cpuUsagePct": 25.5,
              "memoryUsedBytes": 512,
              "memoryTotalBytes": 1024,
              "diskUtilizationPct": 40,
              "networkInBytesSec": 2048
            }
            """;

        var packet = JsonSerializer.Deserialize<MetricPacket>(
            payload,
            new JsonSerializerOptions(JsonSerializerDefaults.Web));

        Assert.NotNull(packet);
        Assert.Equal("server-03", packet.ServerId);
        Assert.Equal(512, packet.MemoryUsedBytes);
        Assert.Equal(2048, packet.NetworkInBytesSec);
    }

    [Fact]
    public async Task GetServerMetricsReturnsNotFoundForUnknownServer()
    {
        await using var db = CreateDbContext();

        var result = await MetricEndpoints.GetServerMetricsAsync(
            "missing-server",
            minutes: null,
            TestAuth.CreatePrincipal(TestOwnerUserId),
            db,
            CancellationToken.None);

        Assert.Equal((int)HttpStatusCode.NotFound, GetStatusCode(result));
    }

    [Fact]
    public async Task GetServerMetricsReturnsPointsWithinWindowOrderedAscending()
    {
        await using var db = CreateDbContext();
        db.Servers.Add(new Server
        {
            Id = "server-04",
            HostName = "server-04",
            LastHeartbeatAt = DateTimeOffset.UtcNow,
            OwnerUserId = TestOwnerUserId,
        });

        var now = DateTimeOffset.UtcNow;
        db.PerformanceMetrics.AddRange(
            NewMetric("server-04", now.AddHours(-2), cpu: 10),
            NewMetric("server-04", now.AddMinutes(-30), cpu: 20),
            NewMetric("server-04", now.AddMinutes(-5), cpu: 30));
        await db.SaveChangesAsync();

        var result = await MetricEndpoints.GetServerMetricsAsync(
            "server-04",
            minutes: 60,
            TestAuth.CreatePrincipal(TestOwnerUserId),
            db,
            CancellationToken.None);

        Assert.Equal((int)HttpStatusCode.OK, GetStatusCode(result));
        var points = Assert.IsType<MetricPoint[]>(GetValue(result));
        Assert.Equal([20f, 30f], points.Select(point => point.CpuUsagePct));
    }

    private static PerformanceMetric NewMetric(string serverId, DateTimeOffset timestamp, float cpu) => new()
    {
        ServerId = serverId,
        Timestamp = timestamp,
        CpuUsagePct = cpu,
        MemoryUsedBytes = 512,
        MemoryTotalBytes = 1024,
        DiskUtilizationPct = 40,
        NetworkInBytesSec = 2048,
    };

    private static Task<IResult> IngestAsync(
        MetricPacket packet,
        NetraDbContext db,
        Guid? ownerUserId = null)
    {
        var httpContext = new DefaultHttpContext();
        httpContext.Items[IngestionTokenFilter.OwnerUserIdKey] =
            ownerUserId ?? TestOwnerUserId;

        return MetricEndpoints.IngestMetricAsync(
            packet,
            httpContext,
            db,
            NullLogger<Program>.Instance,
            CancellationToken.None);
    }

    private static int? GetStatusCode(IResult result) =>
        Assert.IsAssignableFrom<IStatusCodeHttpResult>(result).StatusCode;

    private static object? GetValue(IResult result) =>
        Assert.IsAssignableFrom<IValueHttpResult>(result).Value;

    private static NetraDbContext CreateDbContext()
    {
        var options = new DbContextOptionsBuilder<NetraDbContext>()
            .UseInMemoryDatabase($"netrascope-tests-{Guid.NewGuid()}")
            .Options;

        return new NetraDbContext(options);
    }

    private static MetricPacket ValidPacket() => new(
        ServerId: "test-server",
        Timestamp: DateTimeOffset.UtcNow,
        CpuUsagePct: 25.5f,
        MemoryUsedBytes: 512,
        MemoryTotalBytes: 1024,
        DiskUtilizationPct: 40,
        NetworkInBytesSec: 2048);
}
