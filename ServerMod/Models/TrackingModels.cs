namespace RaidReview.Models;

public record WsPayload(string Action, string Payload);

public record TrackingRaid
{
    public string? SessionId { get; set; }
    public string? ProfileId { get; set; }
    public DateTime Time { get; set; }
    public string? Location { get; set; }
    public string? Type { get; set; }
    public long TimeInRaid { get; set; }
    public string? ExitName { get; set; }
    public string? ExitStatus { get; set; }
    public string? DetectedMods { get; set; }
}

public record TrackingPlayer
{
    public string? SessionId { get; set; }
    public string? ProfileId { get; set; }
    public string? Name { get; set; }
    public int Level { get; set; }
    public string? Team { get; set; }
    public int Group { get; set; }
    public long SpawnTime { get; set; }
    public string? Type { get; set; }
    public string? ModSainBrain { get; set; }
    public string? ModSainDifficulty { get; set; }
}

public record TrackingRaidKill
{
    public string? SessionId { get; set; }
    public long Time { get; set; }
    public string? ProfileId { get; set; }
    public string? KilledId { get; set; }
    public string? Weapon { get; set; }
    public float Distance { get; set; }
    public string? BodyPart { get; set; }
    public string? PositionKiller { get; set; }
    public string? PositionKilled { get; set; }
}

public record TrackingLootItem
{
    public string? SessionId { get; set; }
    public long Time { get; set; }
    public string? ProfileId { get; set; }
    public int Qty { get; set; }
    public string? ItemId { get; set; }
    public string? ItemName { get; set; }
    public bool Added { get; set; }
}

public record TrackingPlayerData
{
    public string? SessionId { get; set; }
    public string? ProfileId { get; set; }
    public long Time { get; set; }
    public float X { get; set; }
    public float Y { get; set; }
    public float Z { get; set; }
    public float Dir { get; set; }
    public float Health { get; set; }
    public float MaxHealth { get; set; }
    public string? RaidId { get; set; }
}

public record TrackingPlayerStatus
{
    public string? SessionId { get; set; }
    public string? ProfileId { get; set; }
    public long Time { get; set; }
    public string? Status { get; set; }
}

public record TrackingBallistic
{
    public string? SessionId { get; set; }
    public long Time { get; set; }
    public string? ProfileId { get; set; }
    public string? WeaponId { get; set; }
    public string? AmmoId { get; set; }
    public string? HitPlayerId { get; set; }
    public string? Source { get; set; }
    public string? Target { get; set; }
}

public record PositionalDataEntry
{
    public string? ProfileId { get; set; }
    public long Time { get; set; }
    public float X { get; set; }
    public float Y { get; set; }
    public float Z { get; set; }
    public float Dir { get; set; }
    public string? RaidId { get; set; }
    public float? Health { get; set; }
    public float? MaxHealth { get; set; }
}
