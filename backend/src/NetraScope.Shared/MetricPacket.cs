namespace NetraScope.Shared;

public sealed record MetricPacket(
    string ServerId,
    DateTimeOffset Timestamp,
    float CpuUsagePct,
    long MemoryUsedBytes,
    long MemoryTotalBytes,
    float DiskUtilizationPct,
    long NetworkInBytesSec);
