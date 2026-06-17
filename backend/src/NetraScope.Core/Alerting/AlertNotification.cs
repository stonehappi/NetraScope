namespace NetraScope.Core.Alerting;

public sealed record AlertNotification(
    string Event,
    long AlertId,
    string ServerId,
    Guid? OwnerUserId,
    string RuleKey,
    string Severity,
    string Status,
    string Message,
    double? TriggerValue,
    double? ThresholdValue,
    DateTimeOffset TriggeredAt,
    DateTimeOffset LastObservedAt,
    DateTimeOffset? ResolvedAt);
