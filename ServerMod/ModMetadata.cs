using SPTarkov.Server.Core.Models.Spt.Mod;

namespace RaidReview;

public record ModMetadata : IModMetadata
{
    public string ModGuid { get; init; } = "ekky.raidreview";
    public string Name { get; init; } = "Raid Review";
    public string Author { get; init; } = "Ekky";
    public List<string>? Contributors { get; init; } = ["Chazu"];
    public SemanticVersioning.Version Version { get; init; } = new("1.6.1");
    public SemanticVersioning.Range SptVersion { get; init; } = new("~4.1.0");
    public bool HasPrepatcher { get; init; } = false;
    public List<string>? Incompatibilities { get; init; }
    public Dictionary<string, SemanticVersioning.Range>? ModDependencies { get; init; }
    public string? Url { get; init; } = "https://github.com/ekky-llc/spt-raid-review";
    public string License { get; init; } = "MIT";
}
