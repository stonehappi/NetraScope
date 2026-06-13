using System.Security.Claims;

namespace NetraScope.Core.Auth;

public static class CurrentUser
{
    public static Guid GetId(ClaimsPrincipal user) =>
        Guid.Parse(user.FindFirstValue(ClaimTypes.NameIdentifier)!);
}
