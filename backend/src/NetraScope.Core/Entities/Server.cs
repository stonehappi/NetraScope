namespace NetraScope.Core.Entities;

public sealed class Server
{
    public required string Id { get; init; }

    public required string HostName { get; set; }

    public string? IpAddress { get; set; }

    public DateTimeOffset LastHeartbeatAt { get; set; }

    public Guid? OwnerUserId { get; set; }

    public User? Owner { get; set; }

    public ICollection<PerformanceMetric> Metrics { get; } = [];

    public ICollection<MetricRollup> MetricRollups { get; } = [];

    public ICollection<ServerTag> ServerTags { get; } = [];

    public ICollection<AlertEvent> AlertEvents { get; } = [];

    public ICollection<AgentToken> AgentTokens { get; } = [];
}
