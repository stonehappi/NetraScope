using System.Text;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using NetraScope.Core.Alerting;
using NetraScope.Core.Auth;
using NetraScope.Core.Data;
using NetraScope.Core.Endpoints;

var builder = WebApplication.CreateBuilder(args);

var connectionString = builder.Configuration.GetConnectionString("NetraScope")
    ?? throw new InvalidOperationException(
        "Connection string 'NetraScope' is required. Set ConnectionStrings__NetraScope.");

builder.Services.AddDbContextPool<NetraDbContext>(options =>
    options.UseNpgsql(connectionString));
builder.Services.AddOpenApi();
builder.Services.Configure<AlertingOptions>(
    builder.Configuration.GetSection(AlertingOptions.SectionName));
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddHttpClient<IAlertNotifier, WebhookAlertNotifier>();
builder.Services.AddScoped<IAlertingService, AlertingService>();
builder.Services.AddHostedService<OfflineAlertWorker>();

var jwtSection = builder.Configuration.GetSection(JwtOptions.SectionName);
builder.Services.Configure<JwtOptions>(jwtSection);

var jwtSecret = jwtSection["Secret"]
    ?? throw new InvalidOperationException(
        "Auth:Jwt:Secret is required. Set Auth__Jwt__Secret.");
var jwtIssuer = jwtSection["Issuer"] ?? "NetraScope";
var jwtAudience = jwtSection["Audience"] ?? "NetraScope";

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = jwtIssuer,
            ValidateAudience = true,
            ValidAudience = jwtAudience,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSecret)),
            ClockSkew = TimeSpan.FromSeconds(30),
        };
    });

builder.Services.AddAuthorization();

// Throttle authentication attempts per client IP to slow credential brute
// forcing and account-spam. Tune limits via Auth:RateLimit configuration.
var authPermitLimit = builder.Configuration.GetValue("Auth:RateLimit:PermitLimit", 10);
var authWindowSeconds = builder.Configuration.GetValue("Auth:RateLimit:WindowSeconds", 60);
var metricsPermitLimit = builder.Configuration.GetValue("Metrics:RateLimit:PermitLimit", 600);
var metricsWindowSeconds = builder.Configuration.GetValue("Metrics:RateLimit:WindowSeconds", 60);
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy(RateLimitPolicies.Auth, httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = authPermitLimit,
                Window = TimeSpan.FromSeconds(authWindowSeconds),
                QueueLimit = 0,
            }));
    options.AddPolicy(RateLimitPolicies.Metrics, httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = metricsPermitLimit,
                Window = TimeSpan.FromSeconds(metricsWindowSeconds),
                QueueLimit = 0,
            }));
});

// CORS for the dashboard: allow any origin.

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(
                policy =>
                    policy.WithOrigins("*")
                        .AllowAnyMethod()
                        .AllowAnyHeader()
                        .SetIsOriginAllowedToAllowWildcardSubdomains()
            );
});

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseCors();

app.UseRateLimiter();

app.UseStaticFiles(new StaticFileOptions
{
    ServeUnknownFileTypes = true,
    DefaultContentType = "application/octet-stream",
});

app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));
app.MapAuthEndpoints();
app.MapMetricEndpoints();
app.MapServerEndpoints();
app.MapAlertEndpoints();
app.MapSecurityEndpoints();

app.Run();

public partial class Program;
