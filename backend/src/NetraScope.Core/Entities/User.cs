namespace NetraScope.Core.Entities;

public sealed class User
{
    public Guid Id { get; init; }

    public required string Username { get; set; }

    public required string PasswordHash { get; set; }

    public required string IngestionToken { get; set; }

    public DateTimeOffset CreatedAt { get; init; }
}
