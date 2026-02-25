using RaidReview.Config;

namespace RaidReview;

/// <summary>
/// Wraps SPT logger actions and provides file-based logging with rotation.
/// Uses Action delegates instead of a generic ISptLogger to avoid generic type mismatch.
/// </summary>
public class RaidReviewLogger
{
    private Action<string>? _logInfo;
    private Action<string>? _logDebug;
    private Action<string>? _logWarn;
    private Action<string>? _logError;
    private string? _logFileName;
    private string _dataFolder = string.Empty;
    private RaidReviewConfig _config = new();

    public void Initialize(
        Action<string> info,
        Action<string> debug,
        Action<string> warn,
        Action<string> error,
        string dataFolder,
        RaidReviewConfig config)
    {
        _logInfo = info;
        _logDebug = debug;
        _logWarn = warn;
        _logError = error;
        _dataFolder = dataFolder;
        _config = config;
        Init();
    }

    public void Init()
    {
        if (!_config.EnableLogFiles) return;

        var logsFolder = Path.Combine(_dataFolder, "logs");
        Directory.CreateDirectory(logsFolder);

        var existingLogs = Directory.GetFiles(logsFolder, "*.log")
            .OrderBy(f => Path.GetFileName(f))
            .ToList();

        while (existingLogs.Count >= _config.MaximumLogFiles && existingLogs.Count > 0)
        {
            File.Delete(existingLogs[0]);
            existingLogs.RemoveAt(0);
        }

        _logFileName = Path.Combine(logsFolder, $"{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}_raid_review.log");
        Log($"New log file created: '{_logFileName}'");
    }

    public void Log(string message)
    {
        _logInfo?.Invoke($"[RAID-REVIEW] {message}");
        AppendToLogFile(message);
    }

    public void Debug(string message)
    {
        if (_config.EnableDebugLogs)
            _logDebug?.Invoke($"[RAID-REVIEW] {message}");
        AppendToLogFile($"[DEBUG] {message}");
    }

    public void Warn(string message)
    {
        _logWarn?.Invoke($"[RAID-REVIEW] {message}");
        AppendToLogFile($"[WARN] {message}");
    }

    public void Error(string message, Exception? ex = null)
    {
        var full = ex != null ? $"{message}: {ex}" : message;
        _logError?.Invoke($"[RAID-REVIEW] {full}");
        AppendToLogFile($"[ERROR] {full}");
    }

    private void AppendToLogFile(string message)
    {
        if (!_config.EnableLogFiles || _logFileName == null) return;
        try
        {
            File.AppendAllText(_logFileName, $"{DateTime.UtcNow:o} - {message}\n");
        }
        catch { /* Don't crash on log failure */ }
    }
}
