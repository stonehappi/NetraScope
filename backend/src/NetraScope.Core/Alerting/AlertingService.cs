using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using NetraScope.Core.Data;
using NetraScope.Core.Entities;
using NetraScope.Shared;

namespace NetraScope.Core.Alerting;

public sealed class AlertingService(
    NetraDbContext db,
    IAlertNotifier notifier,
    IOptions<AlertingOptions> options,
    TimeProvider timeProvider) : IAlertingService
{
    private const string ActiveStatus = "active";
    private const string ResolvedStatus = "resolved";
    private const string CriticalSeverity = "critical";

    public async Task EvaluateMetricAsync(
        MetricPacket packet,
        Guid ownerUserId,
        CancellationToken cancellationToken)
    {
        if (!options.Value.Enabled)
        {
            return;
        }

        var observedAt = packet.Timestamp.ToUniversalTime();
        var memoryPct = packet.MemoryTotalBytes == 0
            ? 0
            : packet.MemoryUsedBytes * 100d / packet.MemoryTotalBytes;

        await EvaluateRuleAsync(
            packet.ServerId,
            ownerUserId,
            "cpu_high_5m",
            await IsCpuSustainedAsync(packet.ServerId, observedAt, cancellationToken),
            packet.CpuUsagePct,
            options.Value.CpuThresholdPct,
            observedAt,
            $"CPU stayed above {options.Value.CpuThresholdPct:0.#}% for {options.Value.CpuSustainedMinutes} minutes.",
            "CPU recovered below the sustained alert threshold.",
            cancellationToken);

        await EvaluateRuleAsync(
            packet.ServerId,
            ownerUserId,
            "memory_high",
            memoryPct > options.Value.MemoryThresholdPct,
            memoryPct,
            options.Value.MemoryThresholdPct,
            observedAt,
            $"Memory usage is {memoryPct:0.#}%, above {options.Value.MemoryThresholdPct:0.#}%.",
            "Memory usage recovered below the alert threshold.",
            cancellationToken);

        await EvaluateRuleAsync(
            packet.ServerId,
            ownerUserId,
            "disk_high",
            packet.DiskUtilizationPct > options.Value.DiskThresholdPct,
            packet.DiskUtilizationPct,
            options.Value.DiskThresholdPct,
            observedAt,
            $"Disk usage is {packet.DiskUtilizationPct:0.#}%, above {options.Value.DiskThresholdPct:0.#}%.",
            "Disk usage recovered below the alert threshold.",
            cancellationToken);

        await ResolveAsync(
            packet.ServerId,
            ownerUserId,
            "server_offline",
            observedAt,
            "Server heartbeat recovered.",
            cancellationToken);
    }

    public async Task EvaluateOfflineServersAsync(CancellationToken cancellationToken)
    {
        if (!options.Value.Enabled)
        {
            return;
        }

        var now = timeProvider.GetUtcNow();
        var cutoff = now.AddMinutes(-options.Value.OfflineMinutes);
        var servers = await db.Servers
            .AsNoTracking()
            .Where(server =>
                server.OwnerUserId != null &&
                server.LastHeartbeatAt <= cutoff)
            .Select(server => new
            {
                server.Id,
                server.OwnerUserId,
                server.LastHeartbeatAt,
            })
            .ToArrayAsync(cancellationToken);

        foreach (var server in servers)
        {
            await TriggerAsync(
                server.Id,
                server.OwnerUserId,
                "server_offline",
                null,
                options.Value.OfflineMinutes,
                now,
                $"Server has been offline since {server.LastHeartbeatAt:u}.",
                cancellationToken);
        }
    }

    private async Task<bool> IsCpuSustainedAsync(
        string serverId,
        DateTimeOffset observedAt,
        CancellationToken cancellationToken)
    {
        var since = observedAt.AddMinutes(-options.Value.CpuSustainedMinutes);
        var points = await db.PerformanceMetrics
            .AsNoTracking()
            .Where(metric =>
                metric.ServerId == serverId &&
                metric.Timestamp >= since &&
                metric.Timestamp <= observedAt)
            .Select(metric => new
            {
                metric.Timestamp,
                metric.CpuUsagePct,
            })
            .ToArrayAsync(cancellationToken);

        return points.Length > 0 &&
            points.Min(point => point.Timestamp) <= since &&
            points.All(point => point.CpuUsagePct > options.Value.CpuThresholdPct);
    }

    private Task EvaluateRuleAsync(
        string serverId,
        Guid? ownerUserId,
        string ruleKey,
        bool isTriggered,
        double triggerValue,
        double thresholdValue,
        DateTimeOffset observedAt,
        string triggerMessage,
        string resolveMessage,
        CancellationToken cancellationToken) =>
        isTriggered
            ? TriggerAsync(
                serverId,
                ownerUserId,
                ruleKey,
                triggerValue,
                thresholdValue,
                observedAt,
                triggerMessage,
                cancellationToken)
            : ResolveAsync(
                serverId,
                ownerUserId,
                ruleKey,
                observedAt,
                resolveMessage,
                cancellationToken);

    private async Task TriggerAsync(
        string serverId,
        Guid? ownerUserId,
        string ruleKey,
        double? triggerValue,
        double? thresholdValue,
        DateTimeOffset observedAt,
        string message,
        CancellationToken cancellationToken)
    {
        var activeAlert = await FindActiveAlertAsync(
            serverId,
            ownerUserId,
            ruleKey,
            cancellationToken);

        if (activeAlert is not null)
        {
            activeAlert.LastObservedAt = observedAt;
            activeAlert.TriggerValue = triggerValue;
            activeAlert.Message = message;
            await db.SaveChangesAsync(cancellationToken);
            return;
        }

        var alert = new AlertEvent
        {
            ServerId = serverId,
            OwnerUserId = ownerUserId,
            RuleKey = ruleKey,
            Severity = CriticalSeverity,
            Status = ActiveStatus,
            Message = message,
            TriggerValue = triggerValue,
            ThresholdValue = thresholdValue,
            TriggeredAt = observedAt,
            LastObservedAt = observedAt,
        };

        db.AlertEvents.Add(alert);
        await db.SaveChangesAsync(cancellationToken);
        await NotifyAsync(alert, cancellationToken);
    }

    private async Task ResolveAsync(
        string serverId,
        Guid? ownerUserId,
        string ruleKey,
        DateTimeOffset observedAt,
        string message,
        CancellationToken cancellationToken)
    {
        var activeAlert = await FindActiveAlertAsync(
            serverId,
            ownerUserId,
            ruleKey,
            cancellationToken);

        if (activeAlert is null)
        {
            return;
        }

        activeAlert.Status = ResolvedStatus;
        activeAlert.Message = message;
        activeAlert.LastObservedAt = observedAt;
        activeAlert.ResolvedAt = observedAt;
        await db.SaveChangesAsync(cancellationToken);
        await NotifyAsync(activeAlert, cancellationToken);
    }

    private Task<AlertEvent?> FindActiveAlertAsync(
        string serverId,
        Guid? ownerUserId,
        string ruleKey,
        CancellationToken cancellationToken) =>
        db.AlertEvents.SingleOrDefaultAsync(
            alert =>
                alert.ServerId == serverId &&
                alert.OwnerUserId == ownerUserId &&
                alert.RuleKey == ruleKey &&
                alert.Status == ActiveStatus,
            cancellationToken);

    private async Task NotifyAsync(AlertEvent alert, CancellationToken cancellationToken)
    {
        await notifier.NotifyAsync(
            new AlertNotification(
                Event: "alert.changed",
                AlertId: alert.Id,
                ServerId: alert.ServerId,
                OwnerUserId: alert.OwnerUserId,
                RuleKey: alert.RuleKey,
                Severity: alert.Severity,
                Status: alert.Status,
                Message: alert.Message,
                TriggerValue: alert.TriggerValue,
                ThresholdValue: alert.ThresholdValue,
                TriggeredAt: alert.TriggeredAt,
                LastObservedAt: alert.LastObservedAt,
                ResolvedAt: alert.ResolvedAt),
            cancellationToken);

        alert.LastNotifiedAt = timeProvider.GetUtcNow();
        await db.SaveChangesAsync(cancellationToken);
    }
}
