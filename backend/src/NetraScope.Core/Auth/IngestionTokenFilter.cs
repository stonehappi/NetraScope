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

        var providedToken = authHeader[BearerPrefix.Length..];
        var db = context.HttpContext.RequestServices.GetRequiredService<NetraDbContext>();
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
        return await next(context);
    }
}
