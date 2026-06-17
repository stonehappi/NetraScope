namespace NetraScope.Core.Auth;

public sealed record IngestionTokenContext(
    Guid OwnerUserId,
    Guid? AgentTokenId,
    string? ServerId,
    bool IsServerScoped);
