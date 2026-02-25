using RaidReview.Config;

namespace RaidReview.Session;

public class SessionManagerRaid
{
    public string RaidId { get; set; } = string.Empty;
    public Dictionary<string, string> Players { get; set; } = new();
    public int Timeout { get; set; } = 0;
}

public class SessionManagerPlayer
{
    public string? RaidId { get; set; }
    public string ProfileId { get; set; } = string.Empty;
    public int Timeout { get; set; } = 0;
}

public class SessionManager
{
    private readonly Dictionary<string, SessionManagerRaid> _raids = new();
    private readonly Dictionary<string, SessionManagerPlayer> _profiles = new();
    private readonly Dictionary<string, System.Timers.Timer> _timeoutTimers = new();
    private readonly RaidReviewLogger _logger;
    private readonly RaidReviewConfig _config;

    public SessionManager(RaidReviewLogger logger, RaidReviewConfig config)
    {
        _logger = logger;
        _config = config;
    }

    // Profile handlers
    public void AddProfile(string profileId, SessionManagerPlayer data)
    {
        _profiles[profileId] = data;
        _logger.Log($"Registered player '{profileId}' to the session manager.");
    }

    public void RemoveProfile(string profileId)
    {
        _profiles.Remove(profileId);
    }

    public IReadOnlyDictionary<string, SessionManagerPlayer> GetProfiles() => _profiles;

    public SessionManagerPlayer? GetProfile(string profileId)
        => _profiles.TryGetValue(profileId, out var p) ? p : null;

    public void PingProfile(string profileId)
    {
        if (_profiles.TryGetValue(profileId, out var p))
            p.Timeout = 0;
    }

    // Raid handlers
    public void AddRaid(string raidId, SessionManagerRaid raidData)
    {
        _raids[raidId] = raidData;
        AddTimeoutInterval(raidId, "raid");
        _logger.Log($"Registered raid '{raidId}' for player(s) '{string.Join(",", raidData.Players.Keys)}'.");
    }

    public void RemoveRaid(string raidId, string removalReason)
    {
        RemoveTimeoutInterval(raidId);

        if (_raids.TryGetValue(raidId, out var raid))
        {
            foreach (var playerId in raid.Players.Keys.ToList())
                RemovePlayerFromRaid(raidId, playerId);
        }

        _raids.Remove(raidId);
        _logger.Log($"Deregistered raid '{raidId}', REASON: {removalReason}");
    }

    public IReadOnlyDictionary<string, SessionManagerRaid> GetRaids() => _raids;

    public SessionManagerRaid? GetRaid(string raidId)
        => _raids.TryGetValue(raidId, out var r) ? r : null;

    public void PingRaid(string raidId)
    {
        if (_raids.TryGetValue(raidId, out var r))
            r.Timeout = 0;
    }

    // Player-to-raid handlers
    public void AddPlayerToRaid(string raidId, string profileId)
    {
        if (_profiles.TryGetValue(profileId, out var player))
            player.RaidId = raidId;
        if (_raids.TryGetValue(raidId, out var raid))
            raid.Players[profileId] = profileId;
    }

    public void RemovePlayerFromRaid(string raidId, string profileId)
    {
        if (_profiles.TryGetValue(profileId, out var player))
            player.RaidId = null;
        if (_raids.TryGetValue(raidId, out var raid))
            raid.Players.Remove(profileId);
    }

    private void AddTimeoutInterval(string timeoutId, string target)
    {
        RemoveTimeoutInterval(timeoutId);

        var timer = new System.Timers.Timer(60_000);
        timer.Elapsed += (_, _) =>
        {
            if (target == "raid")
            {
                var raid = GetRaid(timeoutId);
                if (raid == null) return;
                _logger.Debug($"[RAID_TIMEOUT] Timeout: {raid.Timeout}");
                raid.Timeout++;
                if (raid.Timeout >= _config.SessionManagerRaidTimeout)
                    RemoveRaid(timeoutId, "Raid timed out, no WebSocket packets received from Raid-Review client mod.");
            }
            else if (target == "player")
            {
                var player = GetProfile(timeoutId);
                if (player == null) return;
                _logger.Debug($"[PLAYER_TIMEOUT] Timeout: {player.Timeout}");
                player.Timeout++;
                if (player.Timeout >= _config.SessionManagerPlayerTimeout)
                {
                    if (player.RaidId != null)
                        RemovePlayerFromRaid(player.RaidId, timeoutId);
                    RemoveProfile(timeoutId);
                }
            }
        };
        timer.AutoReset = true;
        timer.Start();
        _timeoutTimers[timeoutId] = timer;
    }

    private void RemoveTimeoutInterval(string timeoutId)
    {
        if (_timeoutTimers.TryGetValue(timeoutId, out var timer))
        {
            timer.Stop();
            timer.Dispose();
            _timeoutTimers.Remove(timeoutId);
        }
    }
}
