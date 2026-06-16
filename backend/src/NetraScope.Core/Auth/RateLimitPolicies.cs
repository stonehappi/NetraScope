namespace NetraScope.Core.Auth;

public static class RateLimitPolicies
{
    /// <summary>
    /// Per-IP throttling applied to authentication endpoints (login/register)
    /// to slow credential brute forcing and account-creation spam.
    /// </summary>
    public const string Auth = "auth";
}
