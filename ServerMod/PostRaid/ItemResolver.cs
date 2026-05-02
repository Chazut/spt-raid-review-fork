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
    private Dictionary<string, string> _shortNames = new();
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

            // Load handbook prices
            var handbookPath = Path.Combine(sptRoot, "SPT_Data", "database", "templates", "handbook.json");
            if (File.Exists(handbookPath))
            {
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
            }
            else
            {
                _logger.Warn($"Handbook not found at '{handbookPath}'.");
            }

            // Load locale short names (extract "{templateId} ShortName" entries)
            var localePath = Path.Combine(sptRoot, "SPT_Data", "database", "locales", "global", "en.json");
            if (File.Exists(localePath))
            {
                using var stream = File.OpenRead(localePath);
                using var doc = JsonDocument.Parse(stream);
                foreach (var prop in doc.RootElement.EnumerateObject())
                {
                    if (!prop.Name.EndsWith(" ShortName", StringComparison.Ordinal)) continue;
                    var templateId = prop.Name.Substring(0, prop.Name.Length - " ShortName".Length);
                    _shortNames[templateId] = prop.Value.GetString() ?? "";
                }
            }
            else
            {
                _logger.Warn($"Locale not found at '{localePath}'.");
            }

            _logger.Log($"ItemResolver loaded {_prices.Count} handbook prices and {_shortNames.Count} short names.");
        }
        catch (Exception ex)
        {
            _logger.Error("ItemResolver init failed", ex);
        }
    }

    /// <summary>
    /// Returns the localized short name for a template id (e.g. "M4A1"), or empty if unknown.
    /// </summary>
    public string ResolveShortName(string templateId)
    {
        if (string.IsNullOrEmpty(templateId)) return "";
        return _shortNames.TryGetValue(templateId, out var n) ? n : "";
    }

    /// <summary>
    /// Returns the handbook price for a template id, or 0 if unknown.
    /// </summary>
    public int ResolvePrice(string templateId)
    {
        if (string.IsNullOrEmpty(templateId)) return 0;
        return _prices.TryGetValue(templateId, out var p) ? p : 0;
    }
}
