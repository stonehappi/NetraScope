using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NetraScope.Core.Auth;
using NetraScope.Core.Contracts;
using NetraScope.Core.Data;

namespace NetraScope.Core.Endpoints;

public static class AlertEndpoints
{
    public static IEndpointRouteBuilder MapAlertEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/alerts").WithTags("Alerts").RequireAuthorization();

        group.MapGet("/", GetAlertsAsync)
            .WithName("GetAlerts")
            .WithSummary("Lists alert events for the current user")
            .Produces<AlertResponse[]>();

        return endpoints;
    }

    public static async Task<IResult> GetAlertsAsync(
        [FromQuery] string? status,
        ClaimsPrincipal user,
        NetraDbContext db,
        CancellationToken cancellationToken)
    {
        var normalizedStatus = status?.Trim().ToLowerInvariant();
        if (normalizedStatus is not null &&
            normalizedStatus is not ("active" or "resolved"))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                [nameof(status)] = ["Status must be active or resolved."],
            });
        }

        var userId = CurrentUser.GetId(user);
        var query = db.AlertEvents
            .AsNoTracking()
            .Where(alert => alert.OwnerUserId == userId);

        if (normalizedStatus is not null)
        {
            query = query.Where(alert => alert.Status == normalizedStatus);
        }

        var alerts = await query
            .OrderByDescending(alert => alert.LastObservedAt)
            .Take(100)
            .Select(alert => new AlertResponse(
                alert.Id,
                alert.ServerId,
                alert.RuleKey,
                alert.Severity,
                alert.Status,
                alert.Message,
                alert.TriggerValue,
                alert.ThresholdValue,
                alert.TriggeredAt,
                alert.LastObservedAt,
                alert.ResolvedAt,
                alert.LastNotifiedAt))
            .ToArrayAsync(cancellationToken);

        return Results.Ok(alerts);
    }
}
