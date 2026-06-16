using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using NetraScope.Core.Auth;
using NetraScope.Core.Contracts;
using NetraScope.Core.Data;
using NetraScope.Core.Entities;

namespace NetraScope.Core.Endpoints;

public static class AuthEndpoints
{
    private const int MinPasswordLength = 8;
    private const int MaxUsernameLength = 100;

    // A throwaway hash used to keep login timing constant when the username
    // does not exist, so attackers cannot enumerate valid usernames by timing.
    private static readonly string DummyPasswordHash =
        new PasswordHasher<User>().HashPassword(
            new User { Username = string.Empty, PasswordHash = string.Empty, IngestionToken = string.Empty },
            "not-a-real-password");

    public static IEndpointRouteBuilder MapAuthEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/auth").WithTags("Auth");

        group.MapPost("/register", RegisterAsync)
            .WithName("Register")
            .WithSummary("Creates a user account")
            .AllowAnonymous()
            .RequireRateLimiting(RateLimitPolicies.Auth)
            .Produces<AuthResponse>(StatusCodes.Status201Created)
            .ProducesValidationProblem();

        group.MapPost("/login", LoginAsync)
            .WithName("Login")
            .WithSummary("Exchanges a username and password for a JWT")
            .AllowAnonymous()
            .RequireRateLimiting(RateLimitPolicies.Auth)
            .Produces<AuthResponse>()
            .Produces(StatusCodes.Status401Unauthorized);

        group.MapGet("/me", GetMeAsync)
            .WithName("GetMe")
            .WithSummary("Gets the current user's profile and ingestion token")
            .RequireAuthorization()
            .Produces<MeResponse>();

        group.MapPost("/token/regenerate", RegenerateIngestionTokenAsync)
            .WithName("RegenerateIngestionToken")
            .WithSummary("Generates a new agent ingestion token, invalidating the previous one")
            .RequireAuthorization()
            .Produces<MeResponse>();

        return endpoints;
    }

    public static async Task<IResult> RegisterAsync(
        [FromBody] RegisterRequest request,
        NetraDbContext db,
        IOptions<JwtOptions> jwtOptions,
        IConfiguration configuration,
        CancellationToken cancellationToken)
    {
        // Registration is open by default but can be disabled on private
        // deployments by setting Auth__AllowRegistration=false.
        if (!configuration.GetValue("Auth:AllowRegistration", true))
        {
            return Results.Problem(
                detail: "Account registration is disabled on this deployment.",
                statusCode: StatusCodes.Status403Forbidden);
        }

        var validationErrors = ValidateCredentials(request.Username, request.Password);
        if (validationErrors.Count > 0)
        {
            return Results.ValidationProblem(validationErrors);
        }

        var normalizedUsername = request.Username.Trim();
        var usernameTaken = await db.Users.AnyAsync(
            user => user.Username == normalizedUsername,
            cancellationToken);
        if (usernameTaken)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                [nameof(request.Username)] = ["Username is already taken."],
            });
        }

        var hasher = new PasswordHasher<User>();
        var user = new User
        {
            Id = Guid.NewGuid(),
            Username = normalizedUsername,
            PasswordHash = string.Empty,
            IngestionToken = IngestionTokenGenerator.Generate(),
            CreatedAt = DateTimeOffset.UtcNow,
        };
        user.PasswordHash = hasher.HashPassword(user, request.Password);

        db.Users.Add(user);
        await db.SaveChangesAsync(cancellationToken);

        var response = CreateAuthResponse(user, jwtOptions.Value);
        return Results.Created($"/api/auth/users/{user.Id}", response);
    }

    public static async Task<IResult> LoginAsync(
        [FromBody] LoginRequest request,
        NetraDbContext db,
        IOptions<JwtOptions> jwtOptions,
        CancellationToken cancellationToken)
    {
        var normalizedUsername = request.Username.Trim();
        var user = await db.Users.SingleOrDefaultAsync(
            u => u.Username == normalizedUsername,
            cancellationToken);

        var hasher = new PasswordHasher<User>();

        // When the username does not exist we still perform a hash verification
        // against a throwaway hash so the response time is indistinguishable
        // from a wrong password, preventing username enumeration via timing.
        if (user is null)
        {
            hasher.VerifyHashedPassword(
                new User { Username = string.Empty, PasswordHash = string.Empty, IngestionToken = string.Empty },
                DummyPasswordHash,
                request.Password);
            return Results.Unauthorized();
        }

        var verification = hasher.VerifyHashedPassword(user, user.PasswordHash, request.Password);
        if (verification == PasswordVerificationResult.Failed)
        {
            return Results.Unauthorized();
        }

        return Results.Ok(CreateAuthResponse(user, jwtOptions.Value));
    }

    public static async Task<IResult> GetMeAsync(
        ClaimsPrincipal currentUser,
        NetraDbContext db,
        CancellationToken cancellationToken)
    {
        var userId = CurrentUser.GetId(currentUser);
        var user = await db.Users.AsNoTracking().SingleAsync(u => u.Id == userId, cancellationToken);
        return Results.Ok(new MeResponse(user.Username, user.IngestionToken));
    }

    public static async Task<IResult> RegenerateIngestionTokenAsync(
        ClaimsPrincipal currentUser,
        NetraDbContext db,
        CancellationToken cancellationToken)
    {
        var userId = CurrentUser.GetId(currentUser);
        var user = await db.Users.SingleAsync(u => u.Id == userId, cancellationToken);
        user.IngestionToken = IngestionTokenGenerator.Generate();
        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(new MeResponse(user.Username, user.IngestionToken));
    }

    private static AuthResponse CreateAuthResponse(User user, JwtOptions options)
    {
        var expiresAt = DateTimeOffset.UtcNow.AddMinutes(options.ExpiryMinutes);
        var claims = new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new Claim(JwtRegisteredClaimNames.UniqueName, user.Username),
        };

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(options.Secret));
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
        var token = new JwtSecurityToken(
            issuer: options.Issuer,
            audience: options.Audience,
            claims: claims,
            expires: expiresAt.UtcDateTime,
            signingCredentials: credentials);

        var tokenString = new JwtSecurityTokenHandler().WriteToken(token);
        return new AuthResponse(tokenString, expiresAt, user.Username);
    }

    private static Dictionary<string, string[]> ValidateCredentials(string? username, string? password)
    {
        var errors = new Dictionary<string, string[]>();

        if (string.IsNullOrWhiteSpace(username))
        {
            errors[nameof(username)] = ["Username is required."];
        }
        else if (username.Trim().Length > MaxUsernameLength)
        {
            errors[nameof(username)] = [$"Username cannot exceed {MaxUsernameLength} characters."];
        }

        if (string.IsNullOrEmpty(password) || password.Length < MinPasswordLength)
        {
            errors[nameof(password)] = [$"Password must be at least {MinPasswordLength} characters."];
        }

        return errors;
    }
}
