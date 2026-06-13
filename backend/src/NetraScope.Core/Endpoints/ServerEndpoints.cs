using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NetraScope.Core.Auth;
using NetraScope.Core.Contracts;
using NetraScope.Core.Data;
using NetraScope.Core.Entities;

namespace NetraScope.Core.Endpoints;

public static class ServerEndpoints
{
    private const int MaxTagsPerServer = 20;
    private const int MaxTagLength = 50;

    public static IEndpointRouteBuilder MapServerEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/servers").WithTags("Servers").RequireAuthorization();

        group.MapGet("/", GetServersAsync)
            .WithName("GetServers")
            .WithSummary("Lists servers, optionally filtered by tag");

        group.MapGet("/{serverId}/tags", GetServerTagsAsync)
            .WithName("GetServerTags")
            .WithSummary("Gets the tags assigned to a server")
            .Produces<ServerTagsResponse>()
            .Produces(StatusCodes.Status404NotFound);

        group.MapPut("/{serverId}/tags", ReplaceServerTagsAsync)
            .WithName("ReplaceServerTags")
            .WithSummary("Replaces all tags assigned to a server")
            .Produces<ServerTagsResponse>()
            .ProducesValidationProblem()
            .Produces(StatusCodes.Status404NotFound);

        return endpoints;
    }

    public static async Task<IResult> GetServersAsync(
        [FromQuery] string? tag,
        ClaimsPrincipal user,
        NetraDbContext db,
        CancellationToken cancellationToken)
    {
        var userId = CurrentUser.GetId(user);
        var normalizedTag = NormalizeTag(tag);
        var query = db.Servers.AsNoTracking().Where(server => server.OwnerUserId == userId);

        if (tag is not null)
        {
            if (normalizedTag is null)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    [nameof(tag)] = ["Tag cannot be empty or exceed 50 characters."],
                });
            }

            query = query.Where(server =>
                server.ServerTags.Any(serverTag => serverTag.TagName == normalizedTag));
        }

        var servers = await query
            .OrderBy(server => server.Id)
            .Select(server => new ServerSummary(
                server.Id,
                server.HostName,
                server.IpAddress,
                server.LastHeartbeatAt,
                server.ServerTags
                    .OrderBy(serverTag => serverTag.TagName)
                    .Select(serverTag => serverTag.TagName)
                    .ToArray()))
            .ToArrayAsync(cancellationToken);

        return Results.Ok(servers);
    }

    public static async Task<IResult> GetServerTagsAsync(
        string serverId,
        ClaimsPrincipal user,
        NetraDbContext db,
        CancellationToken cancellationToken)
    {
        var userId = CurrentUser.GetId(user);
        var response = await db.Servers
            .AsNoTracking()
            .Where(server => server.Id == serverId && server.OwnerUserId == userId)
            .Select(server => new ServerTagsResponse(
                server.Id,
                server.ServerTags
                    .OrderBy(serverTag => serverTag.TagName)
                    .Select(serverTag => serverTag.TagName)
                    .ToArray()))
            .SingleOrDefaultAsync(cancellationToken);

        return response is null ? Results.NotFound() : Results.Ok(response);
    }

    public static async Task<IResult> ReplaceServerTagsAsync(
        string serverId,
        [FromBody] ReplaceServerTagsRequest request,
        ClaimsPrincipal user,
        NetraDbContext db,
        CancellationToken cancellationToken)
    {
        var validationErrors = ValidateAndNormalizeTags(request.Tags, out var normalizedTags);
        if (validationErrors.Count > 0)
        {
            return Results.ValidationProblem(validationErrors);
        }

        var userId = CurrentUser.GetId(user);
        if (!await db.Servers.AnyAsync(
            server => server.Id == serverId && server.OwnerUserId == userId,
            cancellationToken))
        {
            return Results.NotFound();
        }

        await using var transaction = db.Database.IsRelational()
            ? await db.Database.BeginTransactionAsync(cancellationToken)
            : null;

        var existingLinks = await db.ServerTags
            .Where(serverTag => serverTag.ServerId == serverId)
            .ToArrayAsync(cancellationToken);
        db.ServerTags.RemoveRange(existingLinks);

        var existingTagNames = await db.Tags
            .Where(tag => normalizedTags.Contains(tag.Name))
            .Select(tag => tag.Name)
            .ToArrayAsync(cancellationToken);
        var existingTagSet = existingTagNames.ToHashSet(StringComparer.Ordinal);

        foreach (var tagName in normalizedTags)
        {
            if (!existingTagSet.Contains(tagName))
            {
                db.Tags.Add(new Tag { Name = tagName });
            }

            db.ServerTags.Add(new ServerTag
            {
                ServerId = serverId,
                TagName = tagName,
            });
        }

        await db.SaveChangesAsync(cancellationToken);
        if (transaction is not null)
        {
            await transaction.CommitAsync(cancellationToken);
        }

        return Results.Ok(new ServerTagsResponse(serverId, normalizedTags));
    }

    private static Dictionary<string, string[]> ValidateAndNormalizeTags(
        IReadOnlyList<string>? tags,
        out string[] normalizedTags)
    {
        var errors = new Dictionary<string, string[]>();
        if (tags is null)
        {
            errors[nameof(tags)] = ["Tags is required. Use an empty array to remove all tags."];
            normalizedTags = [];
            return errors;
        }

        var invalidTags = tags
            .Where(tag => NormalizeTag(tag) is null)
            .ToArray();
        if (invalidTags.Length > 0)
        {
            errors[nameof(tags)] =
                ["Tags cannot be empty and cannot exceed 50 characters."];
        }

        normalizedTags = tags
            .Select(NormalizeTag)
            .Where(tag => tag is not null)
            .Select(tag => tag!)
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
            .ToArray();

        if (normalizedTags.Length > MaxTagsPerServer)
        {
            errors[nameof(tags)] = [$"A server can have at most {MaxTagsPerServer} tags."];
        }

        return errors;
    }

    private static string? NormalizeTag(string? tag)
    {
        var normalized = tag?.Trim().ToLowerInvariant();
        return string.IsNullOrEmpty(normalized) || normalized.Length > MaxTagLength
            ? null
            : normalized;
    }
}
