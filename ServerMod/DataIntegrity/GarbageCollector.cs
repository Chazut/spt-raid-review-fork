using RaidReview.Config;
using RaidReview.Database;
using RaidReview.FileSystem;

namespace RaidReview.DataIntegrity;

public class GarbageCollector
{
    private readonly DatabaseService _db;
    private readonly DataFileService _fileService;
    private readonly RaidReviewLogger _logger;
    private readonly RaidReviewConfig _config;
    private const string ActiveVersion = "V3";

    public GarbageCollector(DatabaseService db, DataFileService fileService, RaidReviewLogger logger, RaidReviewConfig config)
    {
        _db = db;
        _fileService = fileService;
        _logger = logger;
        _config = config;
    }

    public async Task CollectOldRaidsAsync()
    {
        _logger.Debug($"'config.autoDelete' is set to: '{_config.AutoDelete}'");

        if (!_config.AutoDelete)
        {
            _logger.Warn("Garbage collector for 'old raids' is disabled, watch storage space!");
            return;
        }

        _logger.Log($"Garbage collector deleting old raids, only keeping data for the last '{_config.AutoDeleteLimit}' raids.");

        var oldRaids = await _db.QueryAsync(
            $"SELECT * FROM raid WHERE timeInRaid > 10 ORDER BY created_at DESC LIMIT 1000000 OFFSET {_config.AutoDeleteLimit}");

        if (oldRaids.Count == 0)
        {
            _logger.Log("All good, no old raids to purge.");
            return;
        }

        _logger.Log($"Found '{oldRaids.Count}' raids to delete.");
        foreach (var raid in oldRaids)
        {
            var raidId = raid["raidId"]?.ToString() ?? "";
            await DeleteRaidDataAsync(raidId);
        }
        _logger.Log("Garbage collector is done deleting old raids.");
    }

    public async Task CollectUnfinishedRaidsAsync()
    {
        _logger.Debug($"'config.autoDeleteUnfinishedRaids' is set to: '{_config.AutoDeleteUnfinishedRaids}'");

        if (!_config.AutoDeleteUnfinishedRaids)
        {
            _logger.Warn("Garbage collector for 'unfinished raids' is disabled.");
            return;
        }

        _logger.Log("Garbage collector deleting unfinished raids.");

        // Unfinished raids have an empty exitStatus (END packet never arrived to update it)
        var unfinishedRaids = await _db.QueryAsync(
            "SELECT raidId FROM raid WHERE exitStatus = '' OR exitStatus IS NULL");

        var raidCounts = unfinishedRaids
            .Select(r => r["raidId"]?.ToString() ?? "")
            .Where(id => !string.IsNullOrEmpty(id))
            .ToList();

        if (raidCounts.Count == 0)
        {
            _logger.Log("All good, no unfinished raids to purge.");
            return;
        }

        _logger.Log($"Found '{raidCounts.Count}' raids to delete.");
        foreach (var raidId in raidCounts)
            await DeleteRaidDataAsync(raidId);

        _logger.Log("Garbage collector is done deleting unfinished raids.");
    }

    private async Task DeleteRaidDataAsync(string raidId)
    {
        foreach (var table in new[] { "raid", "kills", "looting", "player", "player_status", "ballistic" })
        {
            await _db.ExecuteAsync($"DELETE FROM {table} WHERE raidId = $raidId",
                ("$raidId", raidId));
        }
        _fileService.DeleteFile("positions", "", "", $"{raidId}_positions");
        _fileService.DeleteFile("positions", "", "", $"{raidId}_{ActiveVersion}_positions.json");
    }
}
