using System.Security.Claims;

namespace NetraScope.Core.Tests;

internal static class TestAuth
{
    public static ClaimsPrincipal CreatePrincipal(Guid userId) =>
        new(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, userId.ToString())], "Test"));
}
