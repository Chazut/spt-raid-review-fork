using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using RaidReview.Database;
using RaidReview.FileSystem;
using RaidReview.PostRaid;
using RaidReview.Session;

namespace RaidReview.WebSocket;

/// <summary>
/// Handles incoming WebSocket messages from the BepInEx client mod.
/// Mirrors the TypeScript packetHandler.ts logic.
/// </summary>
public class WsPacketHandler
{
    private readonly DatabaseService _db;
    private readonly SessionManager _sessionManager;
    private readonly DataFileService _fileService;
    private readonly RaidReviewLogger _logger;
    private readonly ItemResolver _itemResolver;
    private Action<string>? _startPostProcessing;
    private Action? _stopPostProcessing;

    public WsPacketHandler(DatabaseService db, SessionManager sessionManager, DataFileService fileService, RaidReviewLogger logger, ItemResolver itemResolver)
    {
        _db = db;
        _sessionManager = sessionManager;
        _fileService = fileService;
        _logger = logger;
        _itemResolver = itemResolver;
    }

    public void SetPostProcessingCallbacks(Action<string> start, Action stop)
    {
        _startPostProcessing = start;
        _stopPostProcessing = stop;
    }

    public async Task HandleMessageAsync(byte[] rawData)
    {
        try
        {
            var str = Encoding.UTF8.GetString(rawData);

            if (str.Contains("WS_CONNECTED"))
            {
                _logger.Log("Web Socket Client Connected");
                return;
            }

            using var doc = JsonDocument.Parse(str);
            var root = doc.RootElement;

            if (!root.TryGetProperty("Action", out var actionEl) || !root.TryGetProperty("Payload", out var payloadEl))
                return;

            var action = actionEl.GetString() ?? "";
            var payloadStr = payloadEl.GetString() ?? "{}";

            if (action != "POSITION")
                _logger.Debug($"{action}|{payloadStr}");

            using var payloadDoc = JsonDocument.Parse(payloadStr);
            var payload = payloadDoc.RootElement;

            // PLAYER_CHECK payload is a JSON array — extract sessionId from the first element
            string? sessionId = null;
            if (payload.ValueKind == JsonValueKind.Object)
                sessionId = payload.TryGetProperty("sessionId", out var sEl) ? sEl.GetString() : null;
            else if (payload.ValueKind == JsonValueKind.Array && payload.GetArrayLength() > 0)
                sessionId = GetString(payload[0], "sessionId");
            if (sessionId == null) return;

            var sessionManagerProfile = _sessionManager.GetProfile(sessionId);
            if (sessionManagerProfile == null)
            {
                if (action == "START")
                {
                    var newProfile = new SessionManagerPlayer { ProfileId = sessionId };
                    _sessionManager.AddProfile(sessionId, newProfile);
                    sessionManagerProfile = newProfile;
                }
                else
                {
                    _logger.Debug($"[UNREGISTERED_PROFILE] {action}|{sessionId}");
                    return;
                }
            }

            var raidId = sessionManagerProfile.RaidId;

            if (raidId != null)
            {
                _sessionManager.PingRaid(raidId);
                _sessionManager.PingProfile(sessionId);
            }
            else if (raidId == null && action != "START")
            {
                // PLAYER_CHECK often arrives right after END clears the raidId — expected, suppress noise
                if (action != "PLAYER_CHECK")
                    _logger.Debug($"[MISSING_VALUE:'raidId'] {action}|{payloadStr}");
                return;
            }

            switch (action)
            {
                case "START":
                {
                    _logger.Log("Received 'START' trigger.");
                    raidId = Guid.NewGuid().ToString();
                    _logger.Debug($"[START:RAID_GENERATOR] RAID_ID: '{raidId}'");

                    var player = _sessionManager.GetProfile(sessionId)!;
                    player.RaidId = raidId;
                    _sessionManager.AddRaid(raidId, new SessionManagerRaid
                    {
                        RaidId = raidId,
                        Players = new Dictionary<string, string> { [sessionId] = sessionId }
                    });

                    _stopPostProcessing?.Invoke();
                    _logger.Log("Disabled Post Processing: Raid Started");

                    await _db.ExecuteAsync(
                        "INSERT INTO raid (raidId, profileId, location, time, timeInRaid, type, exitName, exitStatus, detectedMods) VALUES ($raidId, $profileId, $location, $time, $timeInRaid, $type, $exitName, $exitStatus, $detectedMods)",
                        ("$raidId", raidId),
                        ("$profileId", GetString(payload, "profileId")),
                        ("$location", GetString(payload, "location")),
                        ("$time", GetString(payload, "time")),
                        ("$timeInRaid", GetString(payload, "timeInRaid")),
                        ("$type", GetString(payload, "type")),
                        ("$exitName", ""),
                        ("$exitStatus", ""),
                        ("$detectedMods", GetString(payload, "detectedMods")));
                    break;
                }

                case "END":
                {
                    await _db.ExecuteAsync(
                        "UPDATE raid SET timeInRaid=$timeInRaid, exitName=$exitName, exitStatus=$exitStatus WHERE raidId=$raidId",
                        ("$raidId", raidId!),
                        ("$timeInRaid", GetString(payload, "timeInRaid")),
                        ("$exitName", GetString(payload, "exitName")),
                        ("$exitStatus", GetString(payload, "exitStatus")));

                    _sessionManager.RemoveRaid(raidId!, "Received 'onGameSessionEnd' packet from Raid-Review client mod.");

                    _startPostProcessing?.Invoke(raidId!);
                    _logger.Log("Enabled Post Processing: Raid Finished");
                    break;
                }

                case "PLAYER_CHECK":
                {
                    // players is an array of TrackingPlayer objects
                    if (payload.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var playerEl in payload.EnumerateArray())
                            await EnsurePlayerExistsAsync(raidId!, playerEl);
                    }
                    break;
                }

                case "PLAYER_UPDATE":
                {
                    await _db.ExecuteAsync(
                        "UPDATE player SET mod_SAIN_brain = $brain, mod_SAIN_difficulty = $diff, type = $type WHERE raidId = $raidId AND profileId = $profileId",
                        ("$brain", GetString(payload, "mod_SAIN_brain")),
                        ("$diff", GetString(payload, "mod_SAIN_difficulty")),
                        ("$type", GetString(payload, "type")),
                        ("$raidId", raidId!),
                        ("$profileId", GetString(payload, "profileId")));
                    break;
                }

                case "PLAYER_STATUS":
                {
                    await _db.ExecuteAsync(
                        "INSERT INTO player_status (raidId, profileId, time, status) VALUES ($raidId, $profileId, $time, $status)",
                        ("$raidId", raidId!),
                        ("$profileId", GetString(payload, "profileId")),
                        ("$time", GetString(payload, "time")),
                        ("$status", GetString(payload, "status")));
                    break;
                }

                case "PLAYER":
                {
                    var profileId = GetString(payload, "profileId");
                    var exists = await _db.QueryAsync(
                        "SELECT * FROM player WHERE raidId = $raidId AND profileId = $profileId",
                        ("$raidId", raidId!), ("$profileId", profileId));

                    if (exists.Count > 0) break;

                    await _db.ExecuteAsync(
                        @"INSERT INTO player (raidId, profileId, level, team, name, ""group"", spawnTime, type, mod_SAIN_brain, mod_SAIN_difficulty) VALUES ($raidId, $profileId, $level, $team, $name, $group, $spawnTime, $type, $brain, $diff)",
                        ("$raidId", raidId!),
                        ("$profileId", profileId),
                        ("$level", GetString(payload, "level")),
                        ("$team", GetString(payload, "team")),
                        ("$name", GetString(payload, "name")),
                        ("$group", GetString(payload, "group")),
                        ("$spawnTime", GetString(payload, "spawnTime")),
                        ("$type", GetString(payload, "type")),
                        ("$brain", GetString(payload, "mod_SAIN_brain")),
                        ("$diff", GetString(payload, "mod_SAIN_difficulty")));
                    break;
                }

                case "BALLISTIC":
                {
                    await _db.ExecuteAsync(
                        "INSERT INTO ballistic (raidId, time, profileId, weaponId, weaponName, ammoId, hitPlayerId, source, target) VALUES ($raidId, $time, $profileId, $weaponId, $weaponName, $ammoId, $hitPlayerId, $source, $target)",
                        ("$raidId", raidId!),
                        ("$time", GetString(payload, "time")),
                        ("$profileId", GetString(payload, "profileId")),
                        ("$weaponId", GetString(payload, "weaponId")),
                        ("$weaponName", GetString(payload, "weaponName")),
                        ("$ammoId", GetString(payload, "ammoId")),
                        ("$hitPlayerId", GetString(payload, "hitPlayerId")),
                        ("$source", GetString(payload, "source")),
                        ("$target", GetString(payload, "target")));
                    break;
                }

                case "KILL":
                {
                    await _db.ExecuteAsync(
                        "INSERT INTO kills (raidId, time, profileId, killedId, weapon, distance, bodyPart, positionKiller, positionKilled) VALUES ($raidId, $time, $profileId, $killedId, $weapon, $distance, $bodyPart, $posKiller, $posKilled)",
                        ("$raidId", raidId!),
                        ("$time", GetString(payload, "time")),
                        ("$profileId", GetString(payload, "profileId")),
                        ("$killedId", GetString(payload, "killedId")),
                        ("$weapon", GetString(payload, "weapon")),
                        ("$distance", GetString(payload, "distance")),
                        ("$bodyPart", GetString(payload, "bodyPart")),
                        ("$posKiller", GetString(payload, "positionKiller")),
                        ("$posKilled", GetString(payload, "positionKilled")));
                    break;
                }

                case "POSITION":
                {
                    if (raidId == null) break;
                    var filename = $"{raidId}_positions";
                    var keys = ExtractKeysLine(payload);
                    var values = ExtractValuesLine(payload);
                    _fileService.WriteLineToFile("positions", "", "", filename, keys + "\n", values + "\n");
                    break;
                }

                case "LOOT":
                {
                    await _db.ExecuteAsync(
                        "INSERT INTO looting (raidId, profileId, time, qty, itemId, itemName, added, templateId, price, x, y, z) VALUES ($raidId, $profileId, $time, $qty, $itemId, $itemName, $added, $templateId, $price, $x, $y, $z)",
                        ("$raidId", raidId!),
                        ("$profileId", GetString(payload, "profileId")),
                        ("$time", GetString(payload, "time")),
                        ("$qty", GetString(payload, "qty")),
                        ("$itemId", GetString(payload, "itemId")),
                        ("$itemName", ResolveItemName(payload)),
                        ("$added", GetString(payload, "added")),
                        ("$templateId", GetString(payload, "templateId")),
                        ("$price", ResolvePrice(payload)),
                        ("$x", GetString(payload, "x")),
                        ("$y", GetString(payload, "y")),
                        ("$z", GetString(payload, "z")));
                    break;
                }

                case "LOOSE_LOOT":
                {
                    if (raidId == null) break;
                    if (payload.TryGetProperty("items", out var itemsArr) && itemsArr.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var item in itemsArr.EnumerateArray())
                        {
                            await _db.ExecuteAsync(
                                @"INSERT OR IGNORE INTO loose_loot (raidId, itemId, templateId, itemName, price, qty, x, y, z, inContainer, containerName)
                                  VALUES ($raidId, $itemId, $templateId, $itemName, $price, $qty, $x, $y, $z, $inContainer, $containerName)",
                                ("$raidId", raidId!),
                                ("$itemId", GetString(item, "itemId")),
                                ("$templateId", GetString(item, "templateId")),
                                ("$itemName", ResolveItemName(item)),
                                ("$price", ResolvePrice(item)),
                                ("$qty", GetString(item, "qty")),
                                ("$x", GetString(item, "x")),
                                ("$y", GetString(item, "y")),
                                ("$z", GetString(item, "z")),
                                ("$inContainer", item.TryGetProperty("inContainer", out var ic) && ic.GetBoolean() ? "1" : "0"),
                                ("$containerName", GetString(item, "containerName")));
                        }
                    }
                    break;
                }

                case "PLAYER_INVENTORY":
                {
                    if (raidId == null) break;
                    var profileId2 = GetString(payload, "profileId");
                    if (payload.TryGetProperty("items", out var invArr) && invArr.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var item in invArr.EnumerateArray())
                        {
                            await _db.ExecuteAsync(
                                @"INSERT INTO player_inventory (raidId, profileId, templateId, itemName, price, qty, slot)
                                  VALUES ($raidId, $profileId, $templateId, $itemName, $price, $qty, $slot)",
                                ("$raidId", raidId!),
                                ("$profileId", profileId2),
                                ("$templateId", GetString(item, "templateId")),
                                ("$itemName", ResolveItemName(item)),
                                ("$price", ResolvePrice(item)),
                                ("$qty", GetString(item, "qty")),
                                ("$slot", GetString(item, "slot")));
                        }
                    }
                    break;
                }

                case "BOT_QUEST":
                {
                    if (raidId == null) break;
                    await _db.ExecuteAsync(
                        @"INSERT INTO bot_quest (raidId, profileId, time, questName, isEFTQuest, actionType, status, objectiveX, objectiveY, objectiveZ)
                          VALUES ($raidId, $profileId, $time, $questName, $isEFTQuest, $actionType, $status, $objX, $objY, $objZ)",
                        ("$raidId", raidId!),
                        ("$profileId", GetString(payload, "profileId")),
                        ("$time", GetString(payload, "time")),
                        ("$questName", GetString(payload, "questName")),
                        ("$isEFTQuest", payload.TryGetProperty("isEFTQuest", out var eft) && eft.GetBoolean() ? "1" : "0"),
                        ("$actionType", GetString(payload, "actionType")),
                        ("$status", GetString(payload, "status")),
                        ("$objX", GetString(payload, "objectiveX")),
                        ("$objY", GetString(payload, "objectiveY")),
                        ("$objZ", GetString(payload, "objectiveZ")));
                    break;
                }
            }
        }
        catch (Exception ex)
        {
            _logger.Error("[WS_DATA_ERR]", ex);
        }
    }

    private async Task EnsurePlayerExistsAsync(string raidId, JsonElement playerEl)
    {
        var profileId = GetString(playerEl, "profileId");
        var exists = await _db.QueryAsync(
            "SELECT 1 FROM player WHERE raidId = $raidId OR profileId = $profileId LIMIT 1",
            ("$raidId", raidId), ("$profileId", profileId));

        if (exists.Count > 0) return;

        await _db.ExecuteAsync(
            @"INSERT INTO player (raidId, profileId, level, team, name, ""group"", spawnTime, mod_SAIN_brain, type, mod_SAIN_difficulty) VALUES ($raidId, $profileId, $level, $team, $name, $group, $spawnTime, $brain, $type, $diff)",
            ("$raidId", raidId),
            ("$profileId", profileId),
            ("$level", GetString(playerEl, "level")),
            ("$team", GetString(playerEl, "team")),
            ("$name", GetString(playerEl, "name")),
            ("$group", GetString(playerEl, "group")),
            ("$spawnTime", GetString(playerEl, "spawnTime")),
            ("$brain", GetString(playerEl, "mod_SAIN_brain")),
            ("$type", GetString(playerEl, "type")),
            ("$diff", GetString(playerEl, "mod_SAIN_difficulty")));
    }

    private static string GetString(JsonElement el, string key)
    {
        if (el.TryGetProperty(key, out var v))
            return v.ValueKind == JsonValueKind.Null ? "" : v.ToString();
        return "";
    }

    /// <summary>
    /// Returns the itemName from the payload, or generates the locale key from
    /// the templateId as a fallback (Fika headless can't resolve names locally).
    /// </summary>
    private string ResolveItemName(JsonElement el)
    {
        var name = GetString(el, "itemName");
        if (!string.IsNullOrEmpty(name)) return name;
        var templateId = GetString(el, "templateId");
        return ItemResolver.ResolveNameKey(templateId);
    }

    /// <summary>
    /// Returns the price from the payload, or looks it up from the handbook
    /// using the templateId as a fallback.
    /// </summary>
    private string ResolvePrice(JsonElement el)
    {
        var price = GetString(el, "price");
        if (!string.IsNullOrEmpty(price) && price != "0") return price;
        var templateId = GetString(el, "templateId");
        var resolved = _itemResolver.ResolvePrice(templateId);
        return resolved > 0 ? resolved.ToString() : price;
    }

    // Extracts a CSV header line from the position payload
    private static string ExtractKeysLine(JsonElement el)
    {
        return string.Join(",", el.EnumerateObject().Select(p => p.Name));
    }

    private static string ExtractValuesLine(JsonElement el)
    {
        return string.Join(",", el.EnumerateObject().Select(p => p.Value.ToString()));
    }
}
