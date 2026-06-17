namespace NetraScope.Core.Metrics;

/// <summary>
/// Maps a requested history window to the storage tier that should serve it.
/// Short windows read raw samples; longer windows read downsampled rollups so
/// charts stay fast and pruned raw data does not leave gaps.
/// </summary>
public static class MetricResolution
{
    public const string FiveMinuteGranularity = "5m";
    public const string HourGranularity = "1h";

    public const int FiveMinuteSeconds = 300;
    public const int HourSeconds = 3600;

    /// <summary>Windows up to this many minutes are served from raw samples (24h).</summary>
    public const int RawWindowMinutes = 1440;

    /// <summary>Windows up to this many minutes are served from 5-minute rollups (7d).</summary>
    public const int FiveMinuteWindowMinutes = 10080;

    /// <summary>Largest window the API will serve, from hourly rollups (365d).</summary>
    public const int MaxWindowMinutes = 525600;

    /// <summary>
    /// Returns the rollup granularity for a window, or <c>null</c> to read raw samples.
    /// </summary>
    public static string? GranularityForWindow(int minutes) => minutes switch
    {
        <= RawWindowMinutes => null,
        <= FiveMinuteWindowMinutes => FiveMinuteGranularity,
        _ => HourGranularity,
    };
}
