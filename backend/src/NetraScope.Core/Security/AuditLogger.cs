using NetraScope.Core.Data;
using NetraScope.Core.Entities;

namespace NetraScope.Core.Security;

public static class AuditLogger
{
    public static void Add(
        NetraDbContext db,
        Guid? ownerUserId,
        string actorType,
        string action,
        string entityType,
        string? entityId,
        string? message,
        HttpContext? httpContext = null)
    {
        db.AuditLogs.Add(new AuditLog
        {
            OwnerUserId = ownerUserId,
            ActorType = actorType,
            Action = action,
            EntityType = entityType,
            EntityId = entityId,
            Message = message,
            IpAddress = httpContext?.Connection.RemoteIpAddress?.ToString(),
            CreatedAt = DateTimeOffset.UtcNow,
        });
    }
}
