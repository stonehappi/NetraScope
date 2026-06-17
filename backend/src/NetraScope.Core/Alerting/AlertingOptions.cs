namespace NetraScope.Core.Alerting;

public sealed class AlertingOptions
{
    public const string SectionName = "Alerting";

    public bool Enabled { get; init; } = true;

    public double CpuThresholdPct { get; init; } = 90;

    public int CpuSustainedMinutes { get; init; } = 5;

    public double MemoryThresholdPct { get; init; } = 90;

    public double DiskThresholdPct { get; init; } = 85;

    public int OfflineMinutes { get; init; } = 2;

    public string[] WebhookUrls { get; init; } = [];

    public string? EmailWebhookUrl { get; init; }

    public string? DiscordWebhookUrl { get; init; }

    public string? SlackWebhookUrl { get; init; }

    public string? TelegramBotToken { get; init; }

    public string? TelegramChatId { get; init; }
}
