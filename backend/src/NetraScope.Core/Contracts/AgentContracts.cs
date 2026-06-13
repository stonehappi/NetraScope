namespace NetraScope.Core.Contracts;

public sealed record AgentDownload(string Os, string Arch, string FileName, long SizeBytes, string Url);
