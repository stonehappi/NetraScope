namespace NetraScope.Core.Entities;

public sealed class AgentToken
{
    public Guid Id { get; init; }

    public required string ServerId { get; init; }

    public Guid OwnerUserId { get; init; }

    public required string Name { get; set; }

    public required string TokenHash { get; set; }

    public required string TokenSuffix { get; set; }

    public string? AllowedIpAddresses { get; set; }

    public DateTimeOffset CreatedAt { get; init; }

    public DateTimeOffset? LastUsedAt { get; set; }

    public DateTimeOffset? RevokedAt { get; set; }

    public Server? Server { get; init; }

    public User? Owner { get; init; }
}
