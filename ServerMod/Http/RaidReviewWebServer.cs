using System.Net;
using System.Net.WebSockets;
using System.Reflection;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using RaidReview.Config;
using RaidReview.Database;
using RaidReview.FileSystem;
using RaidReview.PostRaid;
using RaidReview.WebSocket;

namespace RaidReview.Http;

/// <summary>
/// Runs a standalone Kestrel server on ports 7828 (WebSocket) and 7829 (HTTP/REST + static files).
/// This is completely separate from the SPT server, mirroring the original TypeScript Express+ws setup.
/// </summary>
public class RaidReviewWebServer
{
    private readonly RaidReviewConfig _config;
    private readonly DatabaseService _db;
    private readonly DataFileService _fileService;
    private readonly RaidReviewLogger _logger;
    private readonly WsPacketHandler _wsHandler;
    private readonly RaidPositionCompiler _compiler;
    private readonly string _modFolder;
    private WebApplication? _app;
    private readonly HashSet<string> _raidsToProcess = new();
    private byte[]? _cachedLocaleJson;

    // React frontend embedded in the DLL — no .js files on disk in the mod folder
    private static readonly IReadOnlyDictionary<string, (byte[] Data, string ContentType)> _frontend = LoadEmbeddedFrontend();

    private static Dictionary<string, (byte[] Data, string ContentType)> LoadEmbeddedFrontend()
    {
        var result = new Dictionary<string, (byte[] Data, string ContentType)>(StringComparer.OrdinalIgnoreCase);
        var assembly = Assembly.GetExecutingAssembly();
        const string prefix = "frontend/";

        foreach (var name in assembly.GetManifestResourceNames())
        {
            if (!name.StartsWith(prefix, StringComparison.Ordinal)) continue;

            // Resource name uses OS path separators after the prefix — normalize to URL path
            var path = "/" + name[prefix.Length..].Replace('\\', '/');

            using var stream = assembly.GetManifestResourceStream(name)!;
            using var ms = new MemoryStream();
            stream.CopyTo(ms);

            var ext = Path.GetExtension(path);
            var contentType = ext switch
            {
                ".html" => "text/html; charset=utf-8",
                ".js"   => "text/javascript; charset=utf-8",
                ".css"  => "text/css; charset=utf-8",
                ".svg"  => "image/svg+xml",
                ".png"  => "image/png",
                ".ico"  => "image/x-icon",
                _       => "application/octet-stream"
            };

            result[path] = (ms.ToArray(), contentType);
        }

        return result;
    }

    public RaidReviewWebServer(
        RaidReviewConfig config,
        DatabaseService db,
        DataFileService fileService,
        RaidReviewLogger logger,
        WsPacketHandler wsHandler,
        RaidPositionCompiler compiler,
        string modFolder)
    {
        _config = config;
        _db = db;
        _fileService = fileService;
        _logger = logger;
        _wsHandler = wsHandler;
        _compiler = compiler;
        _modFolder = modFolder;
    }

    public async Task StartAsync()
    {
        var builder = WebApplication.CreateBuilder();

        // Kestrel listens on both ports — no HttpListener/http.sys, so no admin or URL ACL needed.
        // Port 7828: WebSocket endpoint for the BepInEx client mod (connects to ws://127.0.0.1:7828)
        // Port 7829: HTTP REST API + React SPA (frontend embedded in DLL)
        builder.WebHost.ConfigureKestrel(options =>
        {
            options.Listen(IPAddress.Any, _config.WebSocketPort);
            options.Listen(IPAddress.Any, _config.WebClientPort);
        });

        // Suppress noisy ASP.NET Core info logs from polluting the SPT server console
        builder.Logging.SetMinimumLevel(LogLevel.Warning);

        builder.Services.AddCors(opts => opts.AddDefaultPolicy(p => p.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader()));

        _app = builder.Build();
        _app.UseCors();
        _app.UseWebSockets();

        // 1. WebSocket: handle upgrade requests first (BepInEx client on port 7828)
        _app.Use(async (context, next) =>
        {
            if (context.WebSockets.IsWebSocketRequest)
            {
                using var ws = await context.WebSockets.AcceptWebSocketAsync();
                await HandleWebSocketAsync(ws);
                return;
            }
            await next();
        });

        // 2. Serve embedded React frontend static files
        _app.Use(async (context, next) =>
        {
            var path = context.Request.Path.Value ?? "/";
            if (path == "/") path = "/index.html";

            if (_frontend.TryGetValue(path, out var file))
            {
                context.Response.ContentType = file.ContentType;
                await context.Response.Body.WriteAsync(file.Data);
                return;
            }
            await next();
        });

        // 3. REST API routes
        RegisterApiRoutes(_app);

        // 4. SPA fallback — serve index.html for any unmatched path (React Router handles the rest)
        _app.MapFallback(async context =>
        {
            if (_frontend.TryGetValue("/index.html", out var idx))
            {
                context.Response.ContentType = "text/html; charset=utf-8";
                await context.Response.Body.WriteAsync(idx.Data);
            }
            else
            {
                context.Response.StatusCode = 404;
            }
        });

        await _app.StartAsync();
        _logger.Log($"WebSocket Server listening on 'ws://127.0.0.1:{_config.WebSocketPort}'.");
        _logger.Log($"HTTP Web Server running at 'http://127.0.0.1:{_config.WebClientPort}'.");
    }

    private async Task HandleWebSocketAsync(System.Net.WebSockets.WebSocket ws)
    {
        var buffer = new byte[64 * 1024];
        using var ms = new MemoryStream();
        try
        {
            while (true)
            {
                var result = await ws.ReceiveAsync(buffer, CancellationToken.None);
                if (result.MessageType == WebSocketMessageType.Close) break;

                ms.Write(buffer, 0, result.Count);

                if (result.EndOfMessage)
                {
                    await _wsHandler.HandleMessageAsync(ms.ToArray());
                    ms.SetLength(0);
                }
            }
        }
        catch (WebSocketException)
        {
            // Client disconnected abruptly (e.g. game closed) — this is normal, not an error
            _logger.Debug("WebSocket client disconnected (connection closed without handshake).");
        }
        catch (Exception ex)
        {
            _logger.Error("[WS_ERR]", ex);
        }
        finally
        {
            if (ws.State == WebSocketState.Open)
                await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "", CancellationToken.None);
        }
    }

    private void RegisterApiRoutes(WebApplication app)
    {
        // Serve SPT locale data for item/weapon name resolution
        app.MapGet("/api/intl", async context =>
        {
            if (_cachedLocaleJson == null)
            {
                // SPT root is 3 levels up from mod folder: user/mods/RaidReview/ → SPT/
                var sptRoot = Path.GetFullPath(Path.Combine(_modFolder, "..", "..", ".."));
                var localePath = Path.Combine(sptRoot, "SPT_Data", "database", "locales", "global", "en.json");
                if (File.Exists(localePath))
                {
                    _cachedLocaleJson = await File.ReadAllBytesAsync(localePath);
                    _logger.Log($"Loaded locale data from '{localePath}' ({_cachedLocaleJson.Length} bytes).");
                }
                else
                {
                    _logger.Warn($"Locale file not found at '{localePath}'.");
                    _cachedLocaleJson = System.Text.Encoding.UTF8.GetBytes("{}");
                }
            }
            context.Response.ContentType = "application/json";
            await context.Response.Body.WriteAsync(_cachedLocaleJson);
        });

        // Read SPT profile files to get usernames
        app.MapGet("/api/profile/all", async context =>
        {
            var sptRoot = Path.GetFullPath(Path.Combine(_modFolder, "..", "..", ".."));
            var profilesDir = Path.Combine(sptRoot, "user", "profiles");
            var result = new Dictionary<string, object>();

            if (Directory.Exists(profilesDir))
            {
                foreach (var file in Directory.GetFiles(profilesDir, "*.json"))
                {
                    try
                    {
                        var json = await File.ReadAllTextAsync(file);
                        using var doc = JsonDocument.Parse(json);
                        var root = doc.RootElement;
                        if (root.TryGetProperty("info", out var info) &&
                            info.TryGetProperty("id", out var idEl) &&
                            info.TryGetProperty("username", out var usernameEl))
                        {
                            var id = idEl.GetString() ?? "";
                            var username = usernameEl.GetString() ?? "";
                            result[id] = new { info = new { username } };
                        }
                    }
                    catch { /* skip malformed profiles */ }
                }
            }

            await context.Response.WriteAsJsonAsync(result);
        });

        app.MapGet("/api/raids", async context =>
        {
            var profilesParam = context.Request.Query["profiles"].ToString();
            string? profileFilter = null;
            if (!string.IsNullOrEmpty(profilesParam))
            {
                var ids = JsonSerializer.Deserialize<List<string>>(profilesParam);
                if (ids?.Count > 0)
                    profileFilter = string.Join(" AND ", ids.Select(id => $"profileId == '{id}'"));
            }

            var sql = $"SELECT * FROM raid WHERE {(profileFilter != null ? profileFilter + " AND" : "")} timeInRaid > 10 ORDER BY id DESC";
            var data = await _db.QueryAsync(sql);
            await context.Response.WriteAsJsonAsync(data);
        });

        app.MapGet("/api/raids/{raidId}", async (HttpContext context, string raidId) =>
        {
            try
            {
                // Get combined raid data
                var raids = await _db.QueryAsync("SELECT * FROM raid WHERE raidId = $id", ("$id", raidId));
                var kills = await _db.QueryAsync("SELECT * FROM kills WHERE raidId = $id", ("$id", raidId));
                var looting = await _db.QueryAsync("SELECT * FROM looting WHERE raidId = $id", ("$id", raidId));
                var players = await _db.QueryAsync("SELECT * FROM player WHERE raidId = $id", ("$id", raidId));
                var statuses = await _db.QueryAsync("SELECT * FROM player_status WHERE raidId = $id", ("$id", raidId));
                var ballistics = await _db.QueryAsync("SELECT * FROM ballistic WHERE raidId = $id", ("$id", raidId));
                var playerInventory = await _db.QueryAsync("SELECT * FROM player_inventory WHERE raidId = $id", ("$id", raidId));

                var hasCompiledPositions = _fileService.FileExists("positions", "", "", $"{raidId}_{_compiler.ActiveVersion}_positions.json");
                var hasRawPositions = _fileService.FileExists("positions", "", "", $"{raidId}_positions");

                var positionsTracked = hasCompiledPositions ? "COMPILED" : (hasRawPositions ? "RAW" : "NONE");

                if (positionsTracked == "RAW")
                {
                    _compiler.Compile(raidId);
                    positionsTracked = "COMPILED";
                }

                // Flatten: merge raid row fields + nested arrays into a single object
                // The React frontend expects { raidId, profileId, ..., players, kills, looting, player_status, ballistic, positionsTracked }
                var result = raids.Count > 0
                    ? new Dictionary<string, object?>(raids[0])
                    : new Dictionary<string, object?>();
                result["kills"] = kills;
                result["looting"] = looting;
                result["players"] = players;
                result["player_status"] = statuses;
                result["ballistic"] = ballistics;
                result["player_inventory"] = playerInventory;
                result["positionsTracked"] = positionsTracked;
                await context.Response.WriteAsJsonAsync(result);
            }
            catch (Exception ex)
            {
                _logger.Error("[API:RAID]", ex);
                context.Response.StatusCode = 500;
            }
        });

        app.MapGet("/api/raids/{raidId}/positions", async (HttpContext context, string raidId) =>
        {
            var raw = _fileService.ReadFile("positions", "", "", $"{raidId}_{_compiler.ActiveVersion}_positions.json");
            // Compile on-demand if missing but raw CSV exists
            if (raw == null && _fileService.FileExists("positions", "", "", $"{raidId}_positions"))
            {
                _compiler.Compile(raidId);
                raw = _fileService.ReadFile("positions", "", "", $"{raidId}_{_compiler.ActiveVersion}_positions.json");
            }
            if (raw != null)
            {
                context.Response.ContentType = "application/json";
                await context.Response.WriteAsync(raw);
            }
            else
            {
                await context.Response.WriteAsJsonAsync(new object[] { });
            }
        });

        app.MapGet("/api/raids/{raidId}/loose_loot", async (HttpContext context, string raidId) =>
        {
            try
            {
                var data = await _db.QueryAsync("SELECT * FROM loose_loot WHERE raidId = $id", ("$id", raidId));
                await context.Response.WriteAsJsonAsync(data);
            }
            catch (Exception ex)
            {
                _logger.Error("[API:LOOSE_LOOT]", ex);
                context.Response.StatusCode = 500;
            }
        });

        app.MapGet("/api/raids/{raidId}/positions/heatmap", async (HttpContext context, string raidId) =>
        {
            var raw = _fileService.ReadFile("positions", "", "", $"{raidId}_{_compiler.ActiveVersion}_positions.json");
            // Compile on-demand if missing but raw CSV exists
            if (raw == null && _fileService.FileExists("positions", "", "", $"{raidId}_positions"))
            {
                _compiler.Compile(raidId);
                raw = _fileService.ReadFile("positions", "", "", $"{raidId}_{_compiler.ActiveVersion}_positions.json");
            }
            if (raw == null)
            {
                await context.Response.WriteAsJsonAsync(new object[] { });
                return;
            }

            using var doc = JsonDocument.Parse(raw);
            var points = new Dictionary<string, double[]>();
            foreach (var player in doc.RootElement.EnumerateObject())
            {
                foreach (var entry in player.Value.EnumerateArray())
                {
                    double z = entry.TryGetProperty("z", out var zEl) ? zEl.GetDouble() : 0;
                    double x = entry.TryGetProperty("x", out var xEl) ? xEl.GetDouble() : 0;
                    var key = $"{z},{x}";
                    if (points.ContainsKey(key))
                        points[key][2] = Math.Min(points[key][2] + 1, 1);
                    else
                        points[key] = new[] { z, x, 1.0 };
                }
            }
            await context.Response.WriteAsJsonAsync(points.Values);
        });

        app.MapGet("/api/profile/{profileId}/raids/all", async (HttpContext context, string profileId) =>
        {
            var data = await _db.QueryAsync(
                "SELECT * FROM raid WHERE profileId = $id AND timeInRaid > 10 ORDER BY id DESC",
                ("$id", profileId));
            await context.Response.WriteAsJsonAsync(data);
        });

        app.MapGet("/api/raids/{raidId}/tempFiles", async (HttpContext context, string raidId) =>
        {
            var exists = _fileService.FileExists("positions", "", "", $"{raidId}_positions");
            await context.Response.WriteAsJsonAsync(exists);
        });

        app.MapPost("/api/raids/deleteAllData", async context =>
        {
            using var body = await JsonDocument.ParseAsync(context.Request.Body);
            var raidIds = body.RootElement.GetProperty("raidIds").EnumerateArray()
                .Select(e => e.GetString() ?? "").ToList();

            foreach (var raidId in raidIds)
            {
                foreach (var table in new[] { "raid", "kills", "looting", "player", "player_status", "ballistic", "loose_loot", "player_inventory" })
                    await _db.ExecuteAsync($"DELETE FROM {table} WHERE raidId = $id", ("$id", raidId));

                _fileService.DeleteFile("positions", "", "", $"{raidId}_positions");
                _fileService.DeleteFile("positions", "", "", $"{raidId}_{_compiler.ActiveVersion}_positions.json");
            }
            await context.Response.WriteAsJsonAsync(raidIds);
        });

        app.MapPost("/api/raids/deleteTempFiles", async context =>
        {
            using var body = await JsonDocument.ParseAsync(context.Request.Body);
            var raidIds = body.RootElement.GetProperty("raidIds").EnumerateArray()
                .Select(e => e.GetString() ?? "").ToList();

            foreach (var raidId in raidIds)
                _fileService.DeleteFile("positions", "", "", $"{raidId}_positions");

            await context.Response.WriteAsJsonAsync(raidIds);
        });
    }

    public void EnablePostProcessing(string raidId)
    {
        _raidsToProcess.Add(raidId);
    }
}
