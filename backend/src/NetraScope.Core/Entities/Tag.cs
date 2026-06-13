namespace NetraScope.Core.Entities;

public sealed class Tag
{
    public required string Name { get; init; }

    public ICollection<ServerTag> ServerTags { get; } = [];
}
