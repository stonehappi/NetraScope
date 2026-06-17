using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NetraScope.Core.Auth;
using NetraScope.Core.Contracts;
using NetraScope.Core.Data;
using NetraScope.Core.Entities;
using NetraScope.Core.Security;

namespace NetraScope.Core.Endpoints;

public static class SecurityEndpoints
{
    private const int MaxTokenNameLength = 100;

    public static IEndpointRouteBuilder MapSecurityEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var serverGroup = endpoints.MapGroup("/api/servers/{serverId}/tokens")
            .WithTags("Agent Tokens")
            .RequireAuthorization();

        serverGroup.MapGet("/", ListAgentTokensAsync);
        serverGroup.MapPost("/", CreateAgentTokenAsync);
        serverGroup.MapPut("/{tokenId:guid}", UpdateAgentTokenAsync);
        serverGroup.MapPost("/{tokenId:guid}/rotate", RotateAgentTokenAsync);
        serverGroup.MapDelete("/{tokenId:guid}", RevokeAgentTokenAsync);

        endpoints.MapGet("/api/audit-logs", GetAuditLogsAsync)
            .WithTags("Audit")
            .RequireAuthorization()
            .Produces<AuditLogResponse[]>();

        return endpoints;
    }

    public static async Task<IResult> ListAgentTokensAsync(
        string serverId,
        ClaimsPrincipal user,
        NetraDbContext db,
        CancellationToken cancellationToken)
    {
        var userId = CurrentUser.GetId(user);
        if (!await OwnsServerAsync(db, serverId, userId, cancellationToken))
        {
            return Results.NotFound();
        }

        var tokens = await db.AgentTokens
            .AsNoTracking()
            .Where(token => token.ServerId == serverId && token.OwnerUserId == userId)
            .OrderByDescending(token => token.CreatedAt)
            .Select(token => ToResponse(token))
            .ToArrayAsync(cancellationToken);

        return Results.Ok(tokens);
    }

    public static async Task<IResult> CreateAgentTokenAsync(
        string serverId,
        [FromBody] CreateAgentTokenRequest request,
        ClaimsPrincipal user,
        HttpContext httpContext,
        NetraDbContext db,
        CancellationToken cancellationToken)
    {
        var userId = CurrentUser.GetId(user);
        if (!await OwnsServerAsync(db, serverId, userId, cancellationToken))
        {
            return Results.NotFound();
        }

        var validation = ValidateTokenInput(request.Name, request.AllowedIpAddresses, out var name, out var allowedIps);
        if (validation.Count > 0)
        {
            return Results.ValidationProblem(validation);
        }

        var rawToken = IngestionTokenGenerator.Generate();
        var token = new AgentToken
        {
            Id = Guid.NewGuid(),
            ServerId = serverId,
            OwnerUserId = userId,
            Name = name,
            TokenHash = IngestionTokenHasher.Hash(rawToken),
            TokenSuffix = IngestionTokenHasher.Suffix(rawToken),
            AllowedIpAddresses = JoinIpAllowlist(allowedIps),
            CreatedAt = DateTimeOffset.UtcNow,
        };

        db.AgentTokens.Add(token);
        AuditLogger.Add(db, userId, "user", "agent_token.created", "agent_token", token.Id.ToString(), serverId, httpContext);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Created(
            $"/api/servers/{Uri.EscapeDataString(serverId)}/tokens/{token.Id}",
            new AgentTokenCreatedResponse(
                token.Id,
                token.ServerId,
                token.Name,
                rawToken,
                token.TokenSuffix,
                SplitIpAllowlist(token.AllowedIpAddresses),
                token.CreatedAt));
    }

    public static async Task<IResult> UpdateAgentTokenAsync(
        string serverId,
        Guid tokenId,
        [FromBody] UpdateAgentTokenRequest request,
        ClaimsPrincipal user,
        HttpContext httpContext,
        NetraDbContext db,
        CancellationToken cancellationToken)
    {
        var userId = CurrentUser.GetId(user);
        var token = await FindOwnedTokenAsync(db, serverId, tokenId, userId, cancellationToken);
        if (token is null)
        {
            return Results.NotFound();
        }

        var validation = ValidateTokenInput(request.Name, request.AllowedIpAddresses, out var name, out var allowedIps);
        if (validation.Count > 0)
        {
            return Results.ValidationProblem(validation);
        }

        token.Name = name;
        token.AllowedIpAddresses = JoinIpAllowlist(allowedIps);
        AuditLogger.Add(db, userId, "user", "agent_token.updated", "agent_token", token.Id.ToString(), serverId, httpContext);
        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(ToResponse(token));
    }

    public static async Task<IResult> RotateAgentTokenAsync(
        string serverId,
        Guid tokenId,
        ClaimsPrincipal user,
        HttpContext httpContext,
        NetraDbContext db,
        CancellationToken cancellationToken)
    {
        var userId = CurrentUser.GetId(user);
        var token = await FindOwnedTokenAsync(db, serverId, tokenId, userId, cancellationToken);
        if (token is null)
        {
            return Results.NotFound();
        }

        var rawToken = IngestionTokenGenerator.Generate();
        token.TokenHash = IngestionTokenHasher.Hash(rawToken);
        token.TokenSuffix = IngestionTokenHasher.Suffix(rawToken);
        token.LastUsedAt = null;
        token.RevokedAt = null;
        AuditLogger.Add(db, userId, "user", "agent_token.rotated", "agent_token", token.Id.ToString(), serverId, httpContext);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(new AgentTokenCreatedResponse(
            token.Id,
            token.ServerId,
            token.Name,
            rawToken,
            token.TokenSuffix,
            SplitIpAllowlist(token.AllowedIpAddresses),
            token.CreatedAt));
    }

    public static async Task<IResult> RevokeAgentTokenAsync(
        string serverId,
        Guid tokenId,
        ClaimsPrincipal user,
        HttpContext httpContext,
        NetraDbContext db,
        CancellationToken cancellationToken)
    {
        var userId = CurrentUser.GetId(user);
        var token = await FindOwnedTokenAsync(db, serverId, tokenId, userId, cancellationToken);
        if (token is null)
        {
            return Results.NotFound();
        }

        token.RevokedAt ??= DateTimeOffset.UtcNow;
        AuditLogger.Add(db, userId, "user", "agent_token.revoked", "agent_token", token.Id.ToString(), serverId, httpContext);
        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(ToResponse(token));
    }

    public static async Task<IResult> GetAuditLogsAsync(
        ClaimsPrincipal user,
        NetraDbContext db,
        CancellationToken cancellationToken)
    {
        var userId = CurrentUser.GetId(user);
        var logs = await db.AuditLogs
            .AsNoTracking()
            .Where(log => log.OwnerUserId == userId)
            .OrderByDescending(log => log.CreatedAt)
            .Take(100)
            .Select(log => new AuditLogResponse(
                log.Id,
                log.ActorType,
                log.Action,
                log.EntityType,
                log.EntityId,
                log.Message,
                log.IpAddress,
                log.CreatedAt))
            .ToArrayAsync(cancellationToken);

        return Results.Ok(logs);
    }

    private static Task<bool> OwnsServerAsync(
        NetraDbContext db,
        string serverId,
        Guid userId,
        CancellationToken cancellationToken) =>
        db.Servers.AnyAsync(
            server => server.Id == serverId && server.OwnerUserId == userId,
            cancellationToken);

    private static Task<AgentToken?> FindOwnedTokenAsync(
        NetraDbContext db,
        string serverId,
        Guid tokenId,
        Guid userId,
        CancellationToken cancellationToken) =>
        db.AgentTokens.SingleOrDefaultAsync(
            token =>
                token.Id == tokenId &&
                token.ServerId == serverId &&
                token.OwnerUserId == userId,
            cancellationToken);

    private static AgentTokenResponse ToResponse(AgentToken token) => new(
        token.Id,
        token.ServerId,
        token.Name,
        token.TokenSuffix,
        SplitIpAllowlist(token.AllowedIpAddresses),
        token.CreatedAt,
        token.LastUsedAt,
        token.RevokedAt);

    private static Dictionary<string, string[]> ValidateTokenInput(
        string? requestedName,
        IReadOnlyList<string>? requestedAllowedIps,
        out string name,
        out string[] allowedIps)
    {
        var errors = new Dictionary<string, string[]>();
        name = string.IsNullOrWhiteSpace(requestedName) ? "Default agent token" : requestedName.Trim();
        if (name.Length > MaxTokenNameLength)
        {
            errors[nameof(requestedName)] = [$"Name cannot exceed {MaxTokenNameLength} characters."];
        }

        allowedIps = (requestedAllowedIps ?? [])
            .Select(ip => ip.Trim())
            .Where(ip => ip.Length > 0)
            .Distinct(StringComparer.Ordinal)
            .ToArray();

        if (allowedIps.Any(ip => ip.Length > 45 || ip.Contains(',')))
        {
            errors[nameof(requestedAllowedIps)] = ["IP allowlist entries must be plain IP addresses up to 45 characters."];
        }

        return errors;
    }

    private static string? JoinIpAllowlist(IReadOnlyList<string> allowedIps) =>
        allowedIps.Count == 0 ? null : string.Join(',', allowedIps);

    private static string[] SplitIpAllowlist(string? value) =>
        string.IsNullOrWhiteSpace(value)
            ? []
            : value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
}
