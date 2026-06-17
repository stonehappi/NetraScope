using System.Security.Cryptography;
using System.Text;

namespace NetraScope.Core.Auth;

public static class IngestionTokenHasher
{
    public static string Hash(string token)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(token));
        return Convert.ToHexStringLower(bytes);
    }

    public static string Suffix(string token) =>
        token.Length <= 8 ? token : token[^8..];
}
