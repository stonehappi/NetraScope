namespace NetraScope.Core.Entities;

/// <summary>
/// A downsampled metric aggregate for one server over a fixed time bucket.
/// Rollups keep long-range history cheap once the raw samples are pruned.
/// </summary>
public sealed class MetricRollup
{
    /// <summary>Bucket width identifier, e.g. "5m" or "1h".</summary>
    public required string Granularity { get; init; }

    public required string ServerId { get; init; }

    /// <summary>Start of the time bucket (UTC), truncated to the granularity.</summary>
    public DateTimeOffset BucketStart { get; init; }

    public float CpuAvgPct { get; set; }

    public float CpuMaxPct { get; set; }

    public long MemoryUsedAvgBytes { get; set; }

    public long MemoryUsedMaxBytes { get; set; }

    public long MemoryTotalMaxBytes { get; set; }

    public float DiskAvgPct { get; set; }

    public float DiskMaxPct { get; set; }

    public long NetworkInAvgBytesSec { get; set; }

    public long NetworkInMaxBytesSec { get; set; }

    public int SampleCount { get; set; }

    public Server? Server { get; init; }
}
