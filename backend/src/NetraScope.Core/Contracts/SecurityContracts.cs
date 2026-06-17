namespace NetraScope.Core.Contracts;

public sealed record AgentTokenResponse(
    Guid Id,
    string ServerId,
    string Name,
    string TokenSuffix,
    IReadOnlyList<string> AllowedIpAddresses,
    DateTimeOffset CreatedAt,
    DateTimeOffset? LastUsedAt,
    DateTimeOffset? RevokedAt);

public sealed record AgentTokenCreatedResponse(
    Guid Id,
    string ServerId,
    string Name,
    string Token,
    string TokenSuffix,
    IReadOnlyList<string> AllowedIpAddresses,
    DateTimeOffset CreatedAt);

public sealed record CreateAgentTokenRequest(string? Name, IReadOnlyList<string>? AllowedIpAddresses);

public sealed record UpdateAgentTokenRequest(string? Name, IReadOnlyList<string>? AllowedIpAddresses);

public sealed record AuditLogResponse(
    long Id,
    string ActorType,
    string Action,
    string EntityType,
    string? EntityId,
    string? Message,
    string? IpAddress,
    DateTimeOffset CreatedAt);
