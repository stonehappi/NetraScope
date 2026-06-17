namespace NetraScope.Core.Auth;

public static class RateLimitPolicies
{
    /// <summary>
    /// Per-IP throttling applied to authentication endpoints (login/register)
    /// to slow credential brute forcing and account-creation spam.
    /// </summary>
    public const string Auth = "auth";

    /// <summary>
    /// Per-IP throttling applied to metric ingestion so a bad agent or leaked
    /// token cannot flood the API indefinitely.
    /// </summary>
    public const string Metrics = "metrics";
}
