using System.Text.Json;

namespace RaidReview.PostRaid;

/// <summary>
/// Resolves item template IDs to display names and handbook prices.
/// Used to fill in missing data when the Fika headless client cannot resolve
/// item names locally (LocalizedShortName returns empty on stripped GameWorld).
/// </summary>
public class ItemResolver
{
    private Dictionary<string, int> _prices = new();
    private bool _initialized;
    private readonly string _modFolder;
    private readonly RaidReviewLogger _logger;

    public ItemResolver(string modFolder, RaidReviewLogger logger)
    {
        _modFolder = modFolder;
        _logger = logger;
    }

    public void Initialize()
    {
        if (_initialized) return;
        _initialized = true;

        try
        {
            var sptRoot = Path.GetFullPath(Path.Combine(_modFolder, "..", "..", ".."));
            var handbookPath = Path.Combine(sptRoot, "SPT_Data", "database", "templates", "handbook.json");
            if (!File.Exists(handbookPath))
            {
                _logger.Warn($"Handbook not found at '{handbookPath}'.");
                return;
            }

            using var stream = File.OpenRead(handbookPath);
            using var doc = JsonDocument.Parse(stream);
            if (doc.RootElement.TryGetProperty("Items", out var items) && items.ValueKind == JsonValueKind.Array)
            {
                foreach (var entry in items.EnumerateArray())
                {
                    var id = entry.TryGetProperty("Id", out var idEl) ? idEl.GetString() : null;
                    if (string.IsNullOrEmpty(id)) continue;
                    if (entry.TryGetProperty("Price", out var priceEl) && priceEl.TryGetInt32(out var price))
                        _prices[id!] = price;
                }
            }
            _logger.Log($"ItemResolver loaded {_prices.Count} handbook prices.");
        }
        catch (Exception ex)
        {
            _logger.Error("ItemResolver init failed", ex);
        }
    }

    /// <summary>
    /// Returns the localized name key the frontend expects (format: "{templateId} ShortName").
    /// </summary>
    public static string ResolveNameKey(string templateId)
        => string.IsNullOrEmpty(templateId) ? "" : $"{templateId} ShortName";

    /// <summary>
    /// Returns the handbook price for a template id, or 0 if unknown.
    /// </summary>
    public int ResolvePrice(string templateId)
    {
        if (string.IsNullOrEmpty(templateId)) return 0;
        return _prices.TryGetValue(templateId, out var p) ? p : 0;
    }
}
