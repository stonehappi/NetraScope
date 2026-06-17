namespace NetraScope.Core.Contracts;

public sealed record AlertResponse(
    long Id,
    string ServerId,
    string RuleKey,
    string Severity,
    string Status,
    string Message,
    double? TriggerValue,
    double? ThresholdValue,
    DateTimeOffset TriggeredAt,
    DateTimeOffset LastObservedAt,
    DateTimeOffset? ResolvedAt,
    DateTimeOffset? LastNotifiedAt);
