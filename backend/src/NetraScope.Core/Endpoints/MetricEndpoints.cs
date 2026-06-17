using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NetraScope.Core.Alerting;
using NetraScope.Core.Auth;
using NetraScope.Core.Contracts;
using NetraScope.Core.Data;
using NetraScope.Core.Entities;
using NetraScope.Core.Metrics;
using NetraScope.Shared;

namespace NetraScope.Core.Endpoints;

public static class MetricEndpoints
{
    private const int DefaultHistoryMinutes = 60;
    private const int MaxBatchSize = 500;

    public static IEndpointRouteBuilder MapMetricEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/api/metrics", IngestMetricAsync)
            .WithName("IngestMetric")
            .WithSummary("Stores one or more server metric packets")
            .AllowAnonymous()
            .RequireRateLimiting(RateLimitPolicies.Metrics)
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

        var window = Math.Clamp(minutes ?? DefaultHistoryMinutes, 1, MetricResolution.MaxWindowMinutes);
        var since = DateTimeOffset.UtcNow.AddMinutes(-window);
        var granularity = MetricResolution.GranularityForWindow(window);

        // Short windows read raw samples; longer windows read downsampled rollups
        // so charts stay fast and pruned raw data does not leave gaps.
        var points = granularity is null
            ? await db.PerformanceMetrics
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
                .ToArrayAsync(cancellationToken)
            : await db.MetricRollups
                .AsNoTracking()
                .Where(rollup => rollup.ServerId == serverId
                    && rollup.Granularity == granularity
                    && rollup.BucketStart >= since)
                .OrderBy(rollup => rollup.BucketStart)
                .Select(rollup => new MetricPoint(
                    rollup.BucketStart,
                    rollup.CpuAvgPct,
                    rollup.MemoryUsedAvgBytes,
                    rollup.MemoryTotalMaxBytes,
                    rollup.DiskAvgPct,
                    rollup.NetworkInAvgBytesSec))
                .ToArrayAsync(cancellationToken);

        return Results.Ok(points);
    }

    public static async Task<IResult> IngestMetricAsync(
        [FromBody] JsonElement payload,
        HttpContext httpContext,
        NetraDbContext db,
        IAlertingService alerting,
        ILogger<Program> logger,
        CancellationToken cancellationToken)
    {
        var parseResult = ReadMetricPackets(payload);
        if (parseResult.Errors.Count > 0)
        {
            return Results.ValidationProblem(parseResult.Errors);
        }

        var packets = parseResult.Packets;
        var validationErrors = Validate(packets);
        if (validationErrors.Count > 0)
        {
            return Results.ValidationProblem(validationErrors);
        }

        var receivedAt = DateTimeOffset.UtcNow;
        var ipAddress = httpContext.Connection.RemoteIpAddress?.ToString();
        var tokenContext = (IngestionTokenContext)httpContext.Items[IngestionTokenFilter.TokenContextKey]!;
        var ownerUserId = tokenContext.OwnerUserId;
        if (tokenContext.ServerId is not null &&
            packets.Any(packet => packet.ServerId != tokenContext.ServerId))
        {
            return Results.Unauthorized();
        }
        var isNpgsql = db.Database.IsNpgsql();
        await using var transaction = isNpgsql
            ? await db.Database.BeginTransactionAsync(cancellationToken)
            : null;

        foreach (var packet in packets)
        {
            var serverAccepted = isNpgsql
                ? await UpsertServerForNpgsqlAsync(
                    db,
                    packet.ServerId,
                    ipAddress,
                    receivedAt,
                    ownerUserId,
                    cancellationToken)
                : await UpsertServerForNonRelationalProviderAsync(
                    db,
                    packet.ServerId,
                    ipAddress,
                    receivedAt,
                    ownerUserId,
                    cancellationToken);

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
        }

        await db.SaveChangesAsync(cancellationToken);
        if (transaction is not null)
        {
            await transaction.CommitAsync(cancellationToken);
        }

        if (tokenContext.AgentTokenId is not null)
        {
            await db.AgentTokens
                .Where(token => token.Id == tokenContext.AgentTokenId)
                .ExecuteUpdateAsync(
                    setters => setters.SetProperty(
                        token => token.LastUsedAt,
                        DateTimeOffset.UtcNow),
                    cancellationToken);
        }

        foreach (var packet in packets)
        {
            await alerting.EvaluateMetricAsync(packet, ownerUserId, cancellationToken);
        }

        foreach (var packet in packets.Where(packet => packet.CpuUsagePct > 90.0f))
        {
            logger.LogCritical(
                "ALERT: Server {ServerId} CPU is critically high at {CpuUsagePct:F2}%",
                packet.ServerId,
                packet.CpuUsagePct);
        }

        return Results.Accepted();
    }

    private static (MetricPacket[] Packets, Dictionary<string, string[]> Errors) ReadMetricPackets(
        JsonElement payload)
    {
        var errors = new Dictionary<string, string[]>();
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);

        try
        {
            var packets = payload.ValueKind switch
            {
                JsonValueKind.Object => [payload.Deserialize<MetricPacket>(options)!],
                JsonValueKind.Array => payload.Deserialize<MetricPacket[]>(options) ?? [],
                _ => [],
            };

            if (packets.Length == 0)
            {
                errors["Metrics"] = ["At least one metric packet is required."];
            }
            else if (packets.Length > MaxBatchSize)
            {
                errors["Metrics"] = [$"Metric batches cannot exceed {MaxBatchSize} packets."];
            }

            return (packets, errors);
        }
        catch (JsonException)
        {
            errors["Metrics"] = ["Metric payload must be a metric object or an array of metric objects."];
            return ([], errors);
        }
    }

    private static Dictionary<string, string[]> Validate(IReadOnlyList<MetricPacket> packets)
    {
        var errors = new Dictionary<string, string[]>();
        for (var index = 0; index < packets.Count; index++)
        {
            foreach (var (key, value) in Validate(packets[index]))
            {
                errors[$"Metrics[{index}].{key}"] = value;
            }
        }
        return errors;
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

    private static async Task<bool> UpsertServerForNpgsqlAsync(
        NetraDbContext db,
        string serverId,
        string? ipAddress,
        DateTimeOffset receivedAt,
        Guid ownerUserId,
        CancellationToken cancellationToken)
    {
        var affectedRows = await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
            INSERT INTO servers ("Id", "HostName", "IpAddress", "LastHeartbeatAt", "OwnerUserId")
            VALUES ({serverId}, {serverId}, {ipAddress}, {receivedAt}, {ownerUserId})
            ON CONFLICT ("Id") DO UPDATE SET
                "HostName" = EXCLUDED."HostName",
                "IpAddress" = EXCLUDED."IpAddress",
                "LastHeartbeatAt" = EXCLUDED."LastHeartbeatAt",
                "OwnerUserId" = EXCLUDED."OwnerUserId"
            WHERE servers."OwnerUserId" IS NULL
               OR servers."OwnerUserId" = EXCLUDED."OwnerUserId"
            """,
            cancellationToken);
        return affectedRows == 1;
    }

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
