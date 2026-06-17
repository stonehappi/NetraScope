using System.Net;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;
using NetraScope.Core.Auth;
using NetraScope.Core.Contracts;
using NetraScope.Core.Data;
using NetraScope.Core.Endpoints;
using Xunit;

namespace NetraScope.Core.Tests;

public sealed class AuthEndpointTests
{
    [Fact]
    public async Task RegisterCreatesUserAndReturnsToken()
    {
        await using var db = CreateDbContext();

        var result = await AuthEndpoints.RegisterAsync(
            new RegisterRequest("admin", "correct horse battery"),
            db,
            JwtOptionsAccessor(),
            EmptyConfiguration(),
            new DefaultHttpContext(),
            CancellationToken.None);

        Assert.Equal((int)HttpStatusCode.Created, GetStatusCode(result));
        var response = Assert.IsType<AuthResponse>(GetValue(result));
        Assert.Equal("admin", response.Username);
        Assert.NotEmpty(response.Token);
        Assert.Equal(1, await db.Users.CountAsync());

        var user = await db.Users.SingleAsync();
        Assert.NotEmpty(user.IngestionToken);
    }

    [Fact]
    public async Task RegisterAllowsMultipleUsers()
    {
        await using var db = CreateDbContext();
        await AuthEndpoints.RegisterAsync(
            new RegisterRequest("admin", "correct horse battery"),
            db,
            JwtOptionsAccessor(),
            EmptyConfiguration(),
            new DefaultHttpContext(),
            CancellationToken.None);

        var result = await AuthEndpoints.RegisterAsync(
            new RegisterRequest("second", "correct horse battery"),
            db,
            JwtOptionsAccessor(),
            EmptyConfiguration(),
            new DefaultHttpContext(),
            CancellationToken.None);

        Assert.Equal((int)HttpStatusCode.Created, GetStatusCode(result));
        Assert.Equal(2, await db.Users.CountAsync());
    }

    [Fact]
    public async Task RegisterRejectsShortPassword()
    {
        await using var db = CreateDbContext();

        var result = await AuthEndpoints.RegisterAsync(
            new RegisterRequest("admin", "short"),
            db,
            JwtOptionsAccessor(),
            EmptyConfiguration(),
            new DefaultHttpContext(),
            CancellationToken.None);

        Assert.Equal((int)HttpStatusCode.BadRequest, GetStatusCode(result));
        Assert.Empty(db.Users);
    }

    [Fact]
    public async Task RegisterRejectsDuplicateUsername()
    {
        await using var db = CreateDbContext();
        await AuthEndpoints.RegisterAsync(
            new RegisterRequest("admin", "correct horse battery"),
            db,
            JwtOptionsAccessor(),
            EmptyConfiguration(),
            new DefaultHttpContext(),
            CancellationToken.None);

        var result = await AuthEndpoints.RegisterAsync(
            new RegisterRequest("admin", "another password"),
            db,
            JwtOptionsAccessor(),
            EmptyConfiguration(),
            new DefaultHttpContext(),
            CancellationToken.None);

        Assert.Equal((int)HttpStatusCode.BadRequest, GetStatusCode(result));
        Assert.Equal(1, await db.Users.CountAsync());
    }

    [Fact]
    public async Task LoginWithCorrectCredentialsReturnsToken()
    {
        await using var db = CreateDbContext();
        await AuthEndpoints.RegisterAsync(
            new RegisterRequest("admin", "correct horse battery"),
            db,
            JwtOptionsAccessor(),
            EmptyConfiguration(),
            new DefaultHttpContext(),
            CancellationToken.None);

        var result = await AuthEndpoints.LoginAsync(
            new LoginRequest("admin", "correct horse battery"),
            db,
            JwtOptionsAccessor(),
            new DefaultHttpContext(),
            CancellationToken.None);

        Assert.Equal((int)HttpStatusCode.OK, GetStatusCode(result));
        var response = Assert.IsType<AuthResponse>(GetValue(result));
        Assert.Equal("admin", response.Username);
        Assert.NotEmpty(response.Token);
    }

    [Fact]
    public async Task LoginWithWrongPasswordReturnsUnauthorized()
    {
        await using var db = CreateDbContext();
        await AuthEndpoints.RegisterAsync(
            new RegisterRequest("admin", "correct horse battery"),
            db,
            JwtOptionsAccessor(),
            EmptyConfiguration(),
            new DefaultHttpContext(),
            CancellationToken.None);

        var result = await AuthEndpoints.LoginAsync(
            new LoginRequest("admin", "wrong password"),
            db,
            JwtOptionsAccessor(),
            new DefaultHttpContext(),
            CancellationToken.None);

        Assert.Equal((int)HttpStatusCode.Unauthorized, GetStatusCode(result));
    }

    [Fact]
    public async Task GetMeReturnsUsernameAndIngestionToken()
    {
        await using var db = CreateDbContext();
        await AuthEndpoints.RegisterAsync(
            new RegisterRequest("admin", "correct horse battery"),
            db,
            JwtOptionsAccessor(),
            EmptyConfiguration(),
            new DefaultHttpContext(),
            CancellationToken.None);
        var user = await db.Users.SingleAsync();

        var result = await AuthEndpoints.GetMeAsync(
            TestAuth.CreatePrincipal(user.Id),
            new DefaultHttpContext(),
            db,
            CancellationToken.None);

        Assert.Equal((int)HttpStatusCode.OK, GetStatusCode(result));
        var response = Assert.IsType<MeResponse>(GetValue(result));
        Assert.Equal("admin", response.Username);
        Assert.Equal(user.IngestionToken, response.IngestionToken);
    }

    [Fact]
    public async Task RegenerateIngestionTokenReturnsNewToken()
    {
        await using var db = CreateDbContext();
        await AuthEndpoints.RegisterAsync(
            new RegisterRequest("admin", "correct horse battery"),
            db,
            JwtOptionsAccessor(),
            EmptyConfiguration(),
            new DefaultHttpContext(),
            CancellationToken.None);
        var user = await db.Users.SingleAsync();
        var originalToken = user.IngestionToken;

        var result = await AuthEndpoints.RegenerateIngestionTokenAsync(
            TestAuth.CreatePrincipal(user.Id),
            new DefaultHttpContext(),
            db,
            CancellationToken.None);

        Assert.Equal((int)HttpStatusCode.OK, GetStatusCode(result));
        var response = Assert.IsType<MeResponse>(GetValue(result));
        Assert.NotEqual(originalToken, response.IngestionToken);

        var updatedUser = await db.Users.SingleAsync();
        Assert.Equal(response.IngestionToken, updatedUser.IngestionToken);
    }

    [Fact]
    public async Task LoginWithUnknownUsernameReturnsUnauthorized()
    {
        await using var db = CreateDbContext();

        var result = await AuthEndpoints.LoginAsync(
            new LoginRequest("missing", "whatever password"),
            db,
            JwtOptionsAccessor(),
            new DefaultHttpContext(),
            CancellationToken.None);

        Assert.Equal((int)HttpStatusCode.Unauthorized, GetStatusCode(result));
    }

    private static IOptions<JwtOptions> JwtOptionsAccessor() => Options.Create(new JwtOptions
    {
        Secret = "test-secret-test-secret-test-secret-test-secret",
    });

    private static IConfiguration EmptyConfiguration() =>
        new ConfigurationBuilder().Build();

    private static int? GetStatusCode(IResult result) =>
        Assert.IsAssignableFrom<IStatusCodeHttpResult>(result).StatusCode;

    private static object? GetValue(IResult result) =>
        Assert.IsAssignableFrom<IValueHttpResult>(result).Value;

    private static NetraDbContext CreateDbContext()
    {
        var options = new DbContextOptionsBuilder<NetraDbContext>()
            .UseInMemoryDatabase($"netrascope-tests-{Guid.NewGuid()}")
            .Options;

        return new NetraDbContext(options);
    }
}
