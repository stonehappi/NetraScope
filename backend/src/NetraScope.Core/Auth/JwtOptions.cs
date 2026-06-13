namespace NetraScope.Core.Auth;

public sealed class JwtOptions
{
    public const string SectionName = "Auth:Jwt";

    public required string Secret { get; init; }

    public string Issuer { get; init; } = "NetraScope";

    public string Audience { get; init; } = "NetraScope";

    public int ExpiryMinutes { get; init; } = 60;
}
