using SPTarkov.Server.Core.Models.Spt.Mod;

namespace RaidReview;

public record ModMetadata : AbstractModMetadata
{
    public override string ModGuid { get; init; } = "com.ekky.raid-review";
    public override string Name { get; init; } = "Raid Review";
    public override string Author { get; init; } = "Ekky";
    public override List<string>? Contributors { get; init; } = ["Chazu"];
    public override SemanticVersioning.Version Version { get; init; } = new("0.4.0");
    public override SemanticVersioning.Range SptVersion { get; init; } = new("~4.0.0");
    public override List<string>? Incompatibilities { get; init; }
    public override Dictionary<string, SemanticVersioning.Range>? ModDependencies { get; init; }
    public override string? Url { get; init; } = "https://github.com/ekky-llc/spt-raid-review";
    public override bool? IsBundleMod { get; init; } = false;
    public override string License { get; init; } = "MIT";
}
