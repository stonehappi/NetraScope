using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using NetraScope.Core.Contracts;
using NetraScope.Core.Data;
using NetraScope.Core.Endpoints;
using NetraScope.Core.Entities;
using Xunit;

namespace NetraScope.Core.Tests;

public sealed class ServerEndpointTests
{
    private static readonly Guid TestUserId = Guid.NewGuid();

    [Fact]
    public async Task ReplaceTagsNormalizesAndDeduplicatesTags()
    {
        await using var db = CreateDbContext();
        AddServer(db, "server-01");
        await db.SaveChangesAsync();

        var result = await ServerEndpoints.ReplaceServerTagsAsync(
            "server-01",
            new ReplaceServerTagsRequest([" Production ", "LINUX", "production"]),
            TestAuth.CreatePrincipal(TestUserId),
            db,
            CancellationToken.None);

        Assert.Equal(StatusCodes.Status200OK, GetStatusCode(result));
        var response = Assert.IsType<ServerTagsResponse>(GetValue(result));
        Assert.Equal(["linux", "production"], response.Tags);
        Assert.Equal(2, await db.Tags.CountAsync());
        Assert.Equal(2, await db.ServerTags.CountAsync());
    }

    [Fact]
    public async Task ReplaceTagsRemovesPreviousAssignments()
    {
        await using var db = CreateDbContext();
        AddServer(db, "server-02");
        db.Tags.AddRange(new Tag { Name = "linux" }, new Tag { Name = "production" });
        db.ServerTags.AddRange(
            new ServerTag { ServerId = "server-02", TagName = "linux" },
            new ServerTag { ServerId = "server-02", TagName = "production" });
        await db.SaveChangesAsync();

        var result = await ServerEndpoints.ReplaceServerTagsAsync(
            "server-02",
            new ReplaceServerTagsRequest(["database"]),
            TestAuth.CreatePrincipal(TestUserId),
            db,
            CancellationToken.None);

        Assert.Equal(StatusCodes.Status200OK, GetStatusCode(result));
        var assignedTags = await db.ServerTags
            .Where(serverTag => serverTag.ServerId == "server-02")
            .Select(serverTag => serverTag.TagName)
            .ToArrayAsync();
        Assert.Equal(["database"], assignedTags);
    }

    [Fact]
    public async Task EmptyTagArrayClearsAssignments()
    {
        await using var db = CreateDbContext();
        AddServer(db, "server-03");
        db.Tags.Add(new Tag { Name = "production" });
        db.ServerTags.Add(new ServerTag
        {
            ServerId = "server-03",
            TagName = "production",
        });
        await db.SaveChangesAsync();

        var result = await ServerEndpoints.ReplaceServerTagsAsync(
            "server-03",
            new ReplaceServerTagsRequest([]),
            TestAuth.CreatePrincipal(TestUserId),
            db,
            CancellationToken.None);

        Assert.Equal(StatusCodes.Status200OK, GetStatusCode(result));
        Assert.Empty(await db.ServerTags.ToArrayAsync());
    }

    [Fact]
    public async Task GetServersFiltersByNormalizedTag()
    {
        await using var db = CreateDbContext();
        AddServer(db, "production-server");
        AddServer(db, "staging-server");
        db.Tags.Add(new Tag { Name = "production" });
        db.ServerTags.Add(new ServerTag
        {
            ServerId = "production-server",
            TagName = "production",
        });
        await db.SaveChangesAsync();

        var result = await ServerEndpoints.GetServersAsync(
            " Production ",
            TestAuth.CreatePrincipal(TestUserId),
            db,
            CancellationToken.None);

        Assert.Equal(StatusCodes.Status200OK, GetStatusCode(result));
        var servers = Assert.IsType<ServerSummary[]>(GetValue(result));
        var server = Assert.Single(servers);
        Assert.Equal("production-server", server.Id);
        Assert.Equal(["production"], server.Tags);
    }

    [Fact]
    public async Task ReplaceTagsRejectsInvalidTagsAndUnknownServers()
    {
        await using var db = CreateDbContext();
        AddServer(db, "server-04");
        await db.SaveChangesAsync();

        var invalidResult = await ServerEndpoints.ReplaceServerTagsAsync(
            "server-04",
            new ReplaceServerTagsRequest([""]),
            TestAuth.CreatePrincipal(TestUserId),
            db,
            CancellationToken.None);
        var missingResult = await ServerEndpoints.ReplaceServerTagsAsync(
            "missing-server",
            new ReplaceServerTagsRequest(["production"]),
            TestAuth.CreatePrincipal(TestUserId),
            db,
            CancellationToken.None);

        Assert.Equal(StatusCodes.Status400BadRequest, GetStatusCode(invalidResult));
        Assert.Equal(StatusCodes.Status404NotFound, GetStatusCode(missingResult));
    }

    private static int? GetStatusCode(IResult result) =>
        Assert.IsAssignableFrom<IStatusCodeHttpResult>(result).StatusCode;

    private static object? GetValue(IResult result) =>
        Assert.IsAssignableFrom<IValueHttpResult>(result).Value;

    private static NetraDbContext CreateDbContext()
    {
        var options = new DbContextOptionsBuilder<NetraDbContext>()
            .UseInMemoryDatabase($"netrascope-server-tests-{Guid.NewGuid()}")
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
