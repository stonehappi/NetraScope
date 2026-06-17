namespace NetraScope.Core.Entities;

public sealed class AlertEvent
{
    public long Id { get; init; }

    public required string ServerId { get; init; }

    public Guid? OwnerUserId { get; init; }

    public required string RuleKey { get; init; }

    public required string Severity { get; set; }

    public required string Status { get; set; }

    public required string Message { get; set; }

    public double? TriggerValue { get; set; }

    public double? ThresholdValue { get; init; }

    public DateTimeOffset TriggeredAt { get; init; }

    public DateTimeOffset LastObservedAt { get; set; }

    public DateTimeOffset? ResolvedAt { get; set; }

    public DateTimeOffset? LastNotifiedAt { get; set; }

    public Server? Server { get; init; }
}
