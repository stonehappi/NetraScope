using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NetraScope.Core.Auth;
using NetraScope.Core.Contracts;
using NetraScope.Core.Data;
using NetraScope.Core.Entities;
using NetraScope.Shared;

namespace NetraScope.Core.Endpoints;

public static class MetricEndpoints
{
    private const int DefaultHistoryMinutes = 60;
    private const int MaxHistoryMinutes = 1440;

    public static IEndpointRouteBuilder MapMetricEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/api/metrics", IngestMetricAsync)
            .WithName("IngestMetric")
            .WithSummary("Stores one server metric packet")
            .AllowAnonymous()
            .AddEndpointFilter<IngestionTokenFilter>()
            .Produces(StatusCodes.Status202Accepted)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status409Conflict)
            .ProducesValidationProblem();

        endpoints.MapGet("/api/servers/{serverId}/metrics", GetServerMetricsAsync)
            .WithName("GetServerMetrics")
            .WithSummary("Gets recent metric history for a server")
            .RequireAuthorization()
            .Produces<MetricPoint[]>()
            .Produces(StatusCodes.Status404NotFound);

        return endpoints;
    }

    public static async Task<IResult> GetServerMetricsAsync(
        string serverId,
        [FromQuery] int? minutes,
        ClaimsPrincipal user,
        NetraDbContext db,
        CancellationToken cancellationToken)
    {
        var userId = CurrentUser.GetId(user);
        if (!await db.Servers.AnyAsync(
            server => server.Id == serverId && server.OwnerUserId == userId,
            cancellationToken))
        {
            return Results.NotFound();
        }

        var window = Math.Clamp(minutes ?? DefaultHistoryMinutes, 1, MaxHistoryMinutes);
        var since = DateTimeOffset.UtcNow.AddMinutes(-window);

        var points = await db.PerformanceMetrics
            .AsNoTracking()
            .Where(metric => metric.ServerId == serverId && metric.Timestamp >= since)
            .OrderBy(metric => metric.Timestamp)
            .Select(metric => new MetricPoint(
                metric.Timestamp,
                metric.CpuUsagePct,
                metric.MemoryUsedBytes,
                metric.MemoryTotalBytes,
                metric.DiskUtilizationPct,
                metric.NetworkInBytesSec))
            .ToArrayAsync(cancellationToken);

        return Results.Ok(points);
    }

    public static async Task<IResult> IngestMetricAsync(
        [FromBody] MetricPacket packet,
        HttpContext httpContext,
        NetraDbContext db,
        ILogger<Program> logger,
        CancellationToken cancellationToken)
    {
        var validationErrors = Validate(packet);
        if (validationErrors.Count > 0)
        {
            return Results.ValidationProblem(validationErrors);
        }

        var receivedAt = DateTimeOffset.UtcNow;
        var ipAddress = httpContext.Connection.RemoteIpAddress?.ToString();
        var ownerUserId = (Guid)httpContext.Items[IngestionTokenFilter.OwnerUserIdKey]!;
        var isNpgsql = db.Database.IsNpgsql();
        await using var transaction = isNpgsql
            ? await db.Database.BeginTransactionAsync(cancellationToken)
            : null;

        bool serverAccepted;
        if (isNpgsql)
        {
            var affectedRows = await db.Database.ExecuteSqlInterpolatedAsync(
                $"""
                INSERT INTO servers ("Id", "HostName", "IpAddress", "LastHeartbeatAt", "OwnerUserId")
                VALUES ({packet.ServerId}, {packet.ServerId}, {ipAddress}, {receivedAt}, {ownerUserId})
                ON CONFLICT ("Id") DO UPDATE SET
                    "HostName" = EXCLUDED."HostName",
                    "IpAddress" = EXCLUDED."IpAddress",
                    "LastHeartbeatAt" = EXCLUDED."LastHeartbeatAt",
                    "OwnerUserId" = EXCLUDED."OwnerUserId"
                WHERE servers."OwnerUserId" IS NULL
                   OR servers."OwnerUserId" = EXCLUDED."OwnerUserId"
                """,
                cancellationToken);
            serverAccepted = affectedRows == 1;
        }
        else
        {
            serverAccepted = await UpsertServerForNonRelationalProviderAsync(
                db,
                packet.ServerId,
                ipAddress,
                receivedAt,
                ownerUserId,
                cancellationToken);
        }

        if (!serverAccepted)
        {
            return Results.Conflict(new
            {
                title = "Server ID Conflict",
                detail = "This server ID is already owned by another account.",
            });
        }

        db.PerformanceMetrics.Add(new PerformanceMetric
        {
            ServerId = packet.ServerId,
            Timestamp = packet.Timestamp.ToUniversalTime(),
            CpuUsagePct = packet.CpuUsagePct,
            MemoryUsedBytes = packet.MemoryUsedBytes,
            MemoryTotalBytes = packet.MemoryTotalBytes,
            DiskUtilizationPct = packet.DiskUtilizationPct,
            NetworkInBytesSec = packet.NetworkInBytesSec,
        });

        await db.SaveChangesAsync(cancellationToken);
        if (transaction is not null)
        {
            await transaction.CommitAsync(cancellationToken);
        }

        if (packet.CpuUsagePct > 90.0f)
        {
            logger.LogCritical(
                "ALERT: Server {ServerId} CPU is critically high at {CpuUsagePct:F2}%",
                packet.ServerId,
                packet.CpuUsagePct);
        }

        return Results.Accepted();
    }

    private static Dictionary<string, string[]> Validate(MetricPacket packet)
    {
        var errors = new Dictionary<string, string[]>();

        if (string.IsNullOrWhiteSpace(packet.ServerId))
        {
            errors[nameof(packet.ServerId)] = ["ServerId is required."];
        }
        else if (packet.ServerId.Length > 200)
        {
            errors[nameof(packet.ServerId)] = ["ServerId cannot exceed 200 characters."];
        }

        if (packet.Timestamp == default)
        {
            errors[nameof(packet.Timestamp)] = ["Timestamp is required."];
        }

        if (!IsPercentage(packet.CpuUsagePct))
        {
            errors[nameof(packet.CpuUsagePct)] = ["CpuUsagePct must be between 0 and 100."];
        }

        if (!IsPercentage(packet.DiskUtilizationPct))
        {
            errors[nameof(packet.DiskUtilizationPct)] =
                ["DiskUtilizationPct must be between 0 and 100."];
        }

        if (packet.MemoryUsedBytes < 0 ||
            packet.MemoryTotalBytes <= 0 ||
            packet.MemoryUsedBytes > packet.MemoryTotalBytes)
        {
            errors[nameof(packet.MemoryUsedBytes)] =
                ["Memory values must be non-negative and used memory cannot exceed total memory."];
        }

        if (packet.NetworkInBytesSec < 0)
        {
            errors[nameof(packet.NetworkInBytesSec)] =
                ["NetworkInBytesSec cannot be negative."];
        }

        return errors;
    }

    private static bool IsPercentage(float value) =>
        float.IsFinite(value) && value is >= 0 and <= 100;

    private static async Task<bool> UpsertServerForNonRelationalProviderAsync(
        NetraDbContext db,
        string serverId,
        string? ipAddress,
        DateTimeOffset receivedAt,
        Guid ownerUserId,
        CancellationToken cancellationToken)
    {
        var server = await db.Servers.FindAsync([serverId], cancellationToken);
        if (server is null)
        {
            db.Servers.Add(new Server
            {
                Id = serverId,
                HostName = serverId,
                IpAddress = ipAddress,
                LastHeartbeatAt = receivedAt,
                OwnerUserId = ownerUserId,
            });
            return true;
        }

        if (server.OwnerUserId is not null && server.OwnerUserId != ownerUserId)
        {
            return false;
        }

        server.HostName = serverId;
        server.IpAddress = ipAddress;
        server.LastHeartbeatAt = receivedAt;
        server.OwnerUserId = ownerUserId;
        return true;
    }
}
