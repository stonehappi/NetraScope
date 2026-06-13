namespace NetraScope.Core.Contracts;

public sealed record RegisterRequest(string Username, string Password);

public sealed record LoginRequest(string Username, string Password);

public sealed record AuthResponse(string Token, DateTimeOffset ExpiresAt, string Username);

public sealed record MeResponse(string Username, string IngestionToken);
