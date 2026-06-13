namespace NetraScope.Core.Contracts;

public sealed record ReplaceServerTagsRequest(IReadOnlyList<string>? Tags);

public sealed record ServerTagsResponse(string ServerId, IReadOnlyList<string> Tags);

public sealed record ServerSummary(
    string Id,
    string HostName,
    string? IpAddress,
    DateTimeOffset LastHeartbeatAt,
    IReadOnlyList<string> Tags);

public sealed record MetricPoint(
    DateTimeOffset Timestamp,
    float CpuUsagePct,
    long MemoryUsedBytes,
    long MemoryTotalBytes,
    float DiskUtilizationPct,
    long NetworkInBytesSec);
