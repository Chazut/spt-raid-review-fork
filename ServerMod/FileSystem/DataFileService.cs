using System.Collections.Concurrent;

namespace RaidReview.FileSystem;

public class DataFileService
{
    private string _dataFolder = string.Empty;

    // Avoid hammering the disk on every WS POSITION packet (one per
    // player per tick — 80-300/s in a busy raid). Directory.CreateDirectory
    // and File.Exists checks are sync syscalls that were starving the
    // Kestrel thread pool. We remember dirs we've ensured; appended files
    // get a persistent buffered writer (see _appenders below).
    private readonly ConcurrentDictionary<string, byte> _ensuredDirs = new();

    // Persistent buffered writers for the append hot path. File.AppendAllText
    // opens + flushes + closes the file PER LINE — at position-stream rates
    // that's hundreds of full open/close cycles per second, which is exactly
    // what hurts on write-through arrays (Krelsis report). A StreamWriter per
    // file turns those into in-memory buffer writes; a 1s timer flushes so
    // live readers (UI mid-raid) stay at most a second behind. FlushAndCloseAll
    // runs at raid END before post-processing reads the file.
    private readonly ConcurrentDictionary<string, StreamWriter> _appenders = new();
    private readonly object _appenderLock = new();
    private Timer? _flushTimer;

    public void Initialize(string dataFolder)
    {
        _dataFolder = dataFolder;
        _ensuredDirs.Clear();
        FlushAndCloseAll();
        _flushTimer?.Dispose();
        _flushTimer = new Timer(_ => FlushAll(), null, TimeSpan.FromSeconds(1), TimeSpan.FromSeconds(1));
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
    /// Hot-path append used by the WebSocket POSITION dispatch. Writes go to the file's persistent
    /// buffered writer (created on first call; header emitted iff the file is new/empty), so the
    /// per-line cost is a memory copy. The flush timer publishes to disk every second.
    /// </summary>
    public void AppendLineBuffered(string parentFolder, string subFolder, string targetFolder, string fileName, string keys, string value)
    {
        var path = BuildPath(parentFolder, subFolder, targetFolder, fileName);
        var writer = _appenders.GetOrAdd(path, p =>
        {
            EnsureDirectory(Path.GetDirectoryName(p)!);
            // FileShare.Read so the web server can read the (flushed) file while the raid is live.
            var stream = new FileStream(p, FileMode.Append, FileAccess.Write, FileShare.Read);
            var w = new StreamWriter(stream);
            if (stream.Length == 0)
                w.Write(keys);
            return w;
        });
        // StreamWriter isn't thread-safe and WS handlers can run concurrently. One lock for all
        // appenders is plenty at these rates — the critical section is a buffer memcpy.
        lock (_appenderLock)
        {
            writer.Write(value);
        }
    }

    public void FlushAll()
    {
        lock (_appenderLock)
        {
            foreach (var writer in _appenders.Values)
            {
                try { writer.Flush(); }
                catch (ObjectDisposedException) { }
            }
        }
    }

    /// <summary>Flush + close every buffered appender. Called at raid END before post-processing
    /// reads the position files, and on re-initialize.</summary>
    public void FlushAndCloseAll()
    {
        lock (_appenderLock)
        {
            foreach (var kv in _appenders)
            {
                try { kv.Value.Dispose(); }
                catch (ObjectDisposedException) { }
            }
            _appenders.Clear();
        }
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
        // Close the appender first or the open write handle blocks the delete.
        if (_appenders.TryRemove(path, out var writer))
        {
            lock (_appenderLock)
            {
                try { writer.Dispose(); }
                catch (ObjectDisposedException) { }
            }
        }
        if (File.Exists(path))
            File.Delete(path);
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
