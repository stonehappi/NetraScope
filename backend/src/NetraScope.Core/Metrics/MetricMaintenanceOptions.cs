namespace NetraScope.Core.Metrics;

/// <summary>
/// Configures the historical storage strategy: how long each metric tier is
/// kept and how often rollups and pruning run.
/// </summary>
public sealed class MetricMaintenanceOptions
{
    public const string SectionName = "MetricRetention";

    public bool Enabled { get; init; } = true;

    /// <summary>How long raw, full-resolution samples are kept. Default 30 days.</summary>
    public int RawRetentionDays { get; init; } = 30;

    /// <summary>How long 5-minute rollups are kept. Default 90 days.</summary>
    public int FiveMinuteRetentionDays { get; init; } = 90;

    /// <summary>How long hourly rollups are kept. Default 365 days.</summary>
    public int HourRetentionDays { get; init; } = 365;

    /// <summary>How often the maintenance pass runs.</summary>
    public int IntervalMinutes { get; init; } = 5;

    /// <summary>
    /// Recent raw window recomputed into 5-minute rollups each pass. Covers
    /// late-arriving samples without rescanning all history.
    /// </summary>
    public int FiveMinuteLookbackMinutes { get; init; } = 90;

    /// <summary>Recent raw window recomputed into hourly rollups each pass.</summary>
    public int HourLookbackMinutes { get; init; } = 180;
}
