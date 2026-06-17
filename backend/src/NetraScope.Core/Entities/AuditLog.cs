namespace NetraScope.Core.Entities;

public sealed class AuditLog
{
    public long Id { get; init; }

    public Guid? OwnerUserId { get; init; }

    public required string ActorType { get; init; }

    public required string Action { get; init; }

    public required string EntityType { get; init; }

    public string? EntityId { get; init; }

    public string? Message { get; init; }

    public string? IpAddress { get; init; }

    public DateTimeOffset CreatedAt { get; init; }
}
