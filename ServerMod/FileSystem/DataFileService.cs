namespace RaidReview.FileSystem;

public class DataFileService
{
    private string _dataFolder = string.Empty;

    public void Initialize(string dataFolder)
    {
        _dataFolder = dataFolder;
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
        var dir = Path.GetDirectoryName(path)!;
        Directory.CreateDirectory(dir);
        File.WriteAllText(path, content);
    }

    public void WriteLineToFile(string parentFolder, string subFolder, string targetFolder, string fileName, string keys, string value)
    {
        var path = BuildPath(parentFolder, subFolder, targetFolder, fileName);
        var dir = Path.GetDirectoryName(path)!;
        Directory.CreateDirectory(dir);

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
    }

    public List<string> ReadFolderContents(string parentFolder, string subFolder, string targetFolder)
    {
        var dir = BuildPath(parentFolder, subFolder, targetFolder, "");
        if (!Directory.Exists(dir)) return new List<string>();
        return Directory.GetFiles(dir).Select(Path.GetFileName).Where(f => f != null).Cast<string>().ToList();
    }
}
