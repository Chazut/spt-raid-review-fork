using System.Collections.Concurrent;

namespace RaidReview.FileSystem;

public class DataFileService
{
    private string _dataFolder = string.Empty;

    // Avoid hammering the disk on every WS POSITION packet (one per
    // player per tick — 80-300/s in a busy raid). Directory.CreateDirectory
    // and File.Exists checks are sync syscalls that were starving the
    // Kestrel thread pool. We remember dirs we've ensured and files
    // we've already written headers for so the hot path skips them.
    private readonly ConcurrentDictionary<string, byte> _ensuredDirs = new();
    private readonly ConcurrentDictionary<string, byte> _headerWritten = new();

    public void Initialize(string dataFolder)
    {
        _dataFolder = dataFolder;
        _ensuredDirs.Clear();
        _headerWritten.Clear();
    }

    private string BuildPath(string parentFolder, string subFolder, string targetFolder, string fileName)
    {
        var parts = new[] { _dataFolder, parentFolder, subFolder, targetFolder, fileName }
            .Where(p => !string.IsNullOrEmpty(p));
        return Path.Combine(parts.ToArray());
    }

    public void WriteFile(string parentFolder, string subFolder, string targetFolder, string fileName, string content)
    {
        var path = BuildPath(parentFolder, subFolder, targetFolder, fileName);
        EnsureDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, content);
    }

    /// <summary>
    /// Hot-path append used by the WebSocket POSITION dispatch. Async so
    /// the I/O wait doesn't block the Kestrel thread pool, plus dir and
    /// header existence are cached to avoid the per-call FS syscalls.
    /// </summary>
    public async Task WriteLineToFileAsync(string parentFolder, string subFolder, string targetFolder, string fileName, string keys, string value)
    {
        var path = BuildPath(parentFolder, subFolder, targetFolder, fileName);
        EnsureDirectory(Path.GetDirectoryName(path)!);

        // First write to this path: emit the header (the keys line) then
        // the value. Subsequent writes skip the existence check entirely.
        if (_headerWritten.TryAdd(path, 0))
        {
            // The path might already exist from a previous server run
            // (raid resumed, etc.) — in that case we'd duplicate the
            // header. Cheaper to accept that edge than to spam File.Exists.
            if (!File.Exists(path))
            {
                await File.AppendAllTextAsync(path, keys);
            }
        }

        await File.AppendAllTextAsync(path, value);
    }

    /// <summary>Legacy sync variant kept for non-hot callers.</summary>
    public void WriteLineToFile(string parentFolder, string subFolder, string targetFolder, string fileName, string keys, string value)
    {
        var path = BuildPath(parentFolder, subFolder, targetFolder, fileName);
        EnsureDirectory(Path.GetDirectoryName(path)!);

        if (!File.Exists(path))
            File.WriteAllText(path, keys);

        File.AppendAllText(path, value);
    }

    public string? ReadFile(string parentFolder, string subFolder, string targetFolder, string fileName)
    {
        var path = BuildPath(parentFolder, subFolder, targetFolder, fileName);
        return File.Exists(path) ? File.ReadAllText(path) : null;
    }

    public bool FileExists(string parentFolder, string subFolder, string targetFolder, string fileName)
    {
        var path = BuildPath(parentFolder, subFolder, targetFolder, fileName);
        return File.Exists(path);
    }

    public void DeleteFile(string parentFolder, string subFolder, string targetFolder, string fileName)
    {
        var path = BuildPath(parentFolder, subFolder, targetFolder, fileName);
        if (File.Exists(path))
            File.Delete(path);
        _headerWritten.TryRemove(path, out _);
    }

    public List<string> ReadFolderContents(string parentFolder, string subFolder, string targetFolder)
    {
        var dir = BuildPath(parentFolder, subFolder, targetFolder, "");
        if (!Directory.Exists(dir)) return new List<string>();
        return Directory.GetFiles(dir).Select(Path.GetFileName).Where(f => f != null).Cast<string>().ToList();
    }

    private void EnsureDirectory(string dir)
    {
        if (string.IsNullOrEmpty(dir)) return;
        if (_ensuredDirs.ContainsKey(dir)) return;
        Directory.CreateDirectory(dir);
        _ensuredDirs.TryAdd(dir, 0);
    }
}
