using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using NetraScope.Core.Auth;
using NetraScope.Core.Contracts;
using NetraScope.Core.Data;
using NetraScope.Core.Endpoints;
using NetraScope.Core.Entities;
using Xunit;

namespace NetraScope.Core.Tests;

public sealed class SecurityEndpointTests
{
    private static readonly Guid TestUserId = Guid.NewGuid();

    [Fact]
    public async Task CreateAgentTokenReturnsTokenOnceAndStoresHash()
    {
        await using var db = CreateDbContext();
        AddServer(db, "server-01");
        await db.SaveChangesAsync();

        var result = await SecurityEndpoints.CreateAgentTokenAsync(
            "server-01",
            new CreateAgentTokenRequest("primary", ["203.0.113.10"]),
            TestAuth.CreatePrincipal(TestUserId),
            new DefaultHttpContext(),
            db,
            CancellationToken.None);

        Assert.Equal(StatusCodes.Status201Created, GetStatusCode(result));
        var response = Assert.IsType<AgentTokenCreatedResponse>(GetValue(result));
        Assert.NotEmpty(response.Token);
        Assert.Equal("primary", response.Name);
        Assert.Equal(["203.0.113.10"], response.AllowedIpAddresses);

        var stored = await db.AgentTokens.SingleAsync();
        Assert.NotEqual(response.Token, stored.TokenHash);
        Assert.Equal(IngestionTokenHasher.Hash(response.Token), stored.TokenHash);
        Assert.Single(await db.AuditLogs.ToArrayAsync());
    }

    [Fact]
    public async Task RevokeAgentTokenMarksTokenRevoked()
    {
        await using var db = CreateDbContext();
        AddServer(db, "server-02");
        var token = new AgentToken
        {
            Id = Guid.NewGuid(),
            ServerId = "server-02",
            OwnerUserId = TestUserId,
            Name = "primary",
            TokenHash = IngestionTokenHasher.Hash("secret"),
            TokenSuffix = "secret",
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.AgentTokens.Add(token);
        await db.SaveChangesAsync();

        var result = await SecurityEndpoints.RevokeAgentTokenAsync(
            "server-02",
            token.Id,
            TestAuth.CreatePrincipal(TestUserId),
            new DefaultHttpContext(),
            db,
            CancellationToken.None);

        Assert.Equal(StatusCodes.Status200OK, GetStatusCode(result));
        Assert.NotNull((await db.AgentTokens.SingleAsync()).RevokedAt);
    }

    private static int? GetStatusCode(IResult result) =>
        Assert.IsAssignableFrom<IStatusCodeHttpResult>(result).StatusCode;

    private static object? GetValue(IResult result) =>
        Assert.IsAssignableFrom<IValueHttpResult>(result).Value;

    private static NetraDbContext CreateDbContext()
    {
        var options = new DbContextOptionsBuilder<NetraDbContext>()
            .UseInMemoryDatabase($"netrascope-security-tests-{Guid.NewGuid()}")
            .Options;

        return new NetraDbContext(options);
    }

    private static void AddServer(NetraDbContext db, string serverId)
    {
        db.Servers.Add(new Server
        {
            Id = serverId,
            HostName = serverId,
            LastHeartbeatAt = DateTimeOffset.UtcNow,
            OwnerUserId = TestUserId,
        });
    }
}
