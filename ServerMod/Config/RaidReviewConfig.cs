using System.Text.Json;

namespace RaidReview.Config;

public class RaidReviewConfig
{
    public int WebSocketPort { get; set; } = 7828;
    public int WebClientPort { get; set; } = 7829;
    public bool Authentication { get; set; } = false;
    public bool Telemetry { get; set; } = false;
    public bool AutoDelete { get; set; } = true;
    public int AutoDeleteLimit { get; set; } = 30;
    public bool AutoDeleteUnfinishedRaids { get; set; } = true;
    public bool AutoDeleteCronJob { get; set; } = true;
    public bool EnableLogFiles { get; set; } = true;
    public int MaximumLogFiles { get; set; } = 5;
    public bool EnableDebugLogs { get; set; } = false;
    public int SessionManagerRaidTimeout { get; set; } = 5;
    public int SessionManagerPlayerTimeout { get; set; } = 240;

    private static RaidReviewConfig? _instance;

    public static RaidReviewConfig Load(string modFolder)
    {
        var configPath = Path.Combine(modFolder, "config.json");
        if (File.Exists(configPath))
        {
            try
            {
                var json = File.ReadAllText(configPath);
                var opts = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
                // Map snake_case JSON keys manually
                using var doc = JsonDocument.Parse(json);
                var cfg = new RaidReviewConfig();
                var root = doc.RootElement;
                if (root.TryGetProperty("web_socket_port", out var v)) cfg.WebSocketPort = v.GetInt32();
                if (root.TryGetProperty("web_client_port", out v)) cfg.WebClientPort = v.GetInt32();
                if (root.TryGetProperty("authentication", out v)) cfg.Authentication = v.GetBoolean();
                if (root.TryGetProperty("telemetry", out v)) cfg.Telemetry = v.GetBoolean();
                if (root.TryGetProperty("autoDelete", out v)) cfg.AutoDelete = v.GetBoolean();
                if (root.TryGetProperty("autoDeleteLimit", out v)) cfg.AutoDeleteLimit = v.GetInt32();
                if (root.TryGetProperty("autoDeleteUnfinishedRaids", out v)) cfg.AutoDeleteUnfinishedRaids = v.GetBoolean();
                if (root.TryGetProperty("autoDeleteCronJob", out v)) cfg.AutoDeleteCronJob = v.GetBoolean();
                if (root.TryGetProperty("enableLogFiles", out v)) cfg.EnableLogFiles = v.GetBoolean();
                if (root.TryGetProperty("maximumLogFiles", out v)) cfg.MaximumLogFiles = v.GetInt32();
                if (root.TryGetProperty("enableDebugLogs", out v)) cfg.EnableDebugLogs = v.GetBoolean();
                if (root.TryGetProperty("session_manager__raid_timeout", out v)) cfg.SessionManagerRaidTimeout = v.GetInt32();
                if (root.TryGetProperty("session_manager__player_timeout", out v)) cfg.SessionManagerPlayerTimeout = v.GetInt32();
                _instance = cfg;
                return cfg;
            }
            catch
            {
                // Fall through to default
            }
        }
        _instance = new RaidReviewConfig();
        return _instance;
    }

    public static RaidReviewConfig Instance => _instance ?? new RaidReviewConfig();
}
