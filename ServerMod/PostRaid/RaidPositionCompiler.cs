using System.Globalization;
using System.Text.Json;
using RaidReview.FileSystem;
using RaidReview.Models;

namespace RaidReview.PostRaid;

public class RaidPositionCompiler
{
    private const string ActiveStructureVersion = "V3";
    private readonly DataFileService _fileService;
    private readonly RaidReviewLogger _logger;

    public RaidPositionCompiler(DataFileService fileService, RaidReviewLogger logger)
    {
        _fileService = fileService;
        _logger = logger;
    }

    public string ActiveVersion => ActiveStructureVersion;

    public Dictionary<string, List<PositionalDataEntry>>? Compile(string raidGuid)
    {
        _logger.Log($"Starting - Compiling positional data ({ActiveStructureVersion}) for '{raidGuid}'.");

        var rawFile = _fileService.ReadFile("positions", "", "", $"{raidGuid}_positions");
        if (rawFile == null)
        {
            _logger.Log($"No positional data found for '{raidGuid}'.");
            return null;
        }

        var lines = rawFile.Split('\n', StringSplitOptions.RemoveEmptyEntries);
        if (lines.Length < 2)
        {
            _logger.Log($"Positional data file for '{raidGuid}' is empty.");
            return null;
        }

        var keys = lines[0].Replace("\r", "").Split(',');
        // Ensure health fields are present (V2 backwards compat)
        var keysList = keys.ToList();
        if (keysList.Count == 7)
        {
            keysList.Add("health");
            keysList.Add("maxHealth");
        }
        keys = keysList.ToArray();

        var allPositions = new List<PositionalDataEntry>();

        for (int i = 1; i < lines.Length; i++)
        {
            var values = lines[i].Replace("\r", "").Split(',');
            if (values.Length < 7) continue;

            var entry = new PositionalDataEntry();
            for (int k = 0; k < keys.Length && k < values.Length; k++)
            {
                var val = values[k];
                switch (keys[k])
                {
                    case "profileId": entry.ProfileId = val; break;
                    case "time": long.TryParse(val, NumberStyles.Integer, CultureInfo.InvariantCulture, out var t); entry.Time = t; break;
                    case "x": float.TryParse(val, NumberStyles.Float, CultureInfo.InvariantCulture, out var x); entry.X = x; break;
                    case "y": float.TryParse(val, NumberStyles.Float, CultureInfo.InvariantCulture, out var y); entry.Y = y; break;
                    case "z": float.TryParse(val, NumberStyles.Float, CultureInfo.InvariantCulture, out var z); entry.Z = z; break;
                    case "dir": float.TryParse(val, NumberStyles.Float, CultureInfo.InvariantCulture, out var d); entry.Dir = d; break;
                    case "raid_id": entry.RaidId = val; break;
                    case "health": if (float.TryParse(val, NumberStyles.Float, CultureInfo.InvariantCulture, out var h)) entry.Health = h; break;
                    case "maxHealth": if (float.TryParse(val, NumberStyles.Float, CultureInfo.InvariantCulture, out var mh)) entry.MaxHealth = mh; break;
                }
            }
            allPositions.Add(entry);
        }

        _logger.Log($"Found {allPositions.Count} recorded positions for '{raidGuid}'.");

        // Group by profileId, ordered by time
        var grouped = allPositions
            .OrderBy(p => p.Time)
            .GroupBy(p => p.ProfileId ?? "unknown")
            .ToDictionary(g => g.Key, g => g.ToList());

        // Write compiled file with camelCase to match frontend expectations
        var outputPath = $"{raidGuid}_{ActiveStructureVersion}_positions.json";
        var json = JsonSerializer.Serialize(grouped, new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase
        });
        _fileService.WriteFile("positions", "", "", outputPath, json);

        _logger.Log($"Finished compiling positional data for '{raidGuid}'.");
        return grouped;
    }
}
