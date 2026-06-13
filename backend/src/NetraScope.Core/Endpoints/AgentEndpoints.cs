using System.Text.RegularExpressions;
using NetraScope.Core.Contracts;

namespace NetraScope.Core.Endpoints;

public static partial class AgentEndpoints
{
    private const string DownloadsRelativePath = "downloads";

    public static IEndpointRouteBuilder MapAgentEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/agent").WithTags("Agent");

        group.MapGet("/downloads", GetDownloadsAsync)
            .WithName("GetAgentDownloads")
            .WithSummary("Lists available agent binaries by operating system and architecture")
            .Produces<AgentDownload[]>();

        return endpoints;
    }

    public static IResult GetDownloadsAsync(IWebHostEnvironment environment)
    {
        var downloadsPath = Path.Combine(environment.WebRootPath, DownloadsRelativePath);
        if (!Directory.Exists(downloadsPath))
        {
            return Results.Ok(Array.Empty<AgentDownload>());
        }

        var downloads = Directory.EnumerateFiles(downloadsPath)
            .Select(filePath => (FilePath: filePath, FileName: Path.GetFileName(filePath)))
            .Select(file => (file, Match: FileNamePattern().Match(file.FileName)))
            .Where(item => item.Match.Success)
            .Select(item => new AgentDownload(
                Os: item.Match.Groups["os"].Value,
                Arch: item.Match.Groups["arch"].Value,
                FileName: item.file.FileName,
                SizeBytes: new FileInfo(item.file.FilePath).Length,
                Url: $"/{DownloadsRelativePath}/{item.file.FileName}"))
            .OrderBy(download => download.Os)
            .ThenBy(download => download.Arch)
            .ToArray();

        return Results.Ok(downloads);
    }

    [GeneratedRegex(@"^netrascope-agent-(?<os>[a-z0-9]+)-(?<arch>[a-z0-9]+)(\.exe)?$")]
    private static partial Regex FileNamePattern();
}
