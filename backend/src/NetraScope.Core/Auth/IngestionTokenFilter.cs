using Microsoft.EntityFrameworkCore;
using NetraScope.Core.Data;

namespace NetraScope.Core.Auth;

/// <summary>
/// Resolves the bearer token agents send with metric submissions to the
/// owning user's <see cref="Entities.User.IngestionToken"/> and stores the
/// matched user id in <see cref="HttpContext.Items"/> as <see cref="OwnerUserIdKey"/>.
/// </summary>
public sealed class IngestionTokenFilter : IEndpointFilter
{
    public const string OwnerUserIdKey = "OwnerUserId";
    public const string TokenContextKey = "IngestionTokenContext";

    private const string BearerPrefix = "Bearer ";

    public async ValueTask<object?> InvokeAsync(
        EndpointFilterInvocationContext context,
        EndpointFilterDelegate next)
    {
        var authHeader = context.HttpContext.Request.Headers.Authorization.ToString();
        if (!authHeader.StartsWith(BearerPrefix, StringComparison.Ordinal))
        {
            return Results.Unauthorized();
        }

        var providedToken = authHeader[BearerPrefix.Length..].Trim();
        var tokenHash = IngestionTokenHasher.Hash(providedToken);
        var db = context.HttpContext.RequestServices.GetRequiredService<NetraDbContext>();

        var agentToken = await db.AgentTokens
            .AsNoTracking()
            .Where(token => token.TokenHash == tokenHash && token.RevokedAt == null)
            .Select(token => new
            {
                token.Id,
                token.OwnerUserId,
                token.ServerId,
                token.AllowedIpAddresses,
            })
            .SingleOrDefaultAsync(context.HttpContext.RequestAborted);

        if (agentToken is not null)
        {
            var remoteIp = context.HttpContext.Connection.RemoteIpAddress?.ToString();
            if (!IpAllowed(agentToken.AllowedIpAddresses, remoteIp))
            {
                return Results.Unauthorized();
            }

            var tokenContext = new IngestionTokenContext(
                agentToken.OwnerUserId,
                agentToken.Id,
                agentToken.ServerId,
                IsServerScoped: true);
            context.HttpContext.Items[OwnerUserIdKey] = agentToken.OwnerUserId;
            context.HttpContext.Items[TokenContextKey] = tokenContext;
            return await next(context);
        }

        var ownerUserId = await db.Users
            .AsNoTracking()
            .Where(user => user.IngestionToken == providedToken)
            .Select(user => user.Id)
            .SingleOrDefaultAsync(context.HttpContext.RequestAborted);

        if (ownerUserId == Guid.Empty)
        {
            return Results.Unauthorized();
        }

        context.HttpContext.Items[OwnerUserIdKey] = ownerUserId;
        context.HttpContext.Items[TokenContextKey] = new IngestionTokenContext(
            ownerUserId,
            AgentTokenId: null,
            ServerId: null,
            IsServerScoped: false);
        return await next(context);
    }

    private static bool IpAllowed(string? allowedIpAddresses, string? remoteIp)
    {
        if (string.IsNullOrWhiteSpace(allowedIpAddresses))
        {
            return true;
        }

        if (string.IsNullOrWhiteSpace(remoteIp))
        {
            return false;
        }

        return allowedIpAddresses
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Any(ip => string.Equals(ip, remoteIp, StringComparison.Ordinal));
    }
}
