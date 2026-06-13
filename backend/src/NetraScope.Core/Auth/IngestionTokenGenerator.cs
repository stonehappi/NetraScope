using System.Security.Cryptography;

namespace NetraScope.Core.Auth;

public static class IngestionTokenGenerator
{
    private const int TokenBytes = 32;

    public static string Generate() => Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(TokenBytes));
}
