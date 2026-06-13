namespace NetraScope.Core.Entities;

public sealed class ServerTag
{
    public required string ServerId { get; init; }

    public required string TagName { get; init; }

    public Server? Server { get; init; }

    public Tag? Tag { get; init; }
}
