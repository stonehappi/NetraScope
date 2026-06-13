namespace NetraScope.Core.Entities;

public sealed class PerformanceMetric
{
    public long Id { get; init; }

    public required string ServerId { get; init; }

    public DateTimeOffset Timestamp { get; init; }

    public float CpuUsagePct { get; init; }

    public long MemoryUsedBytes { get; init; }

    public long MemoryTotalBytes { get; init; }

    public float DiskUtilizationPct { get; init; }

    public long NetworkInBytesSec { get; init; }

    public Server? Server { get; init; }
}
