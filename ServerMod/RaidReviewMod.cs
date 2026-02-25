using SPTarkov.DI.Annotations;
using SPTarkov.Server.Core.DI;
using SPTarkov.Server.Core.Models.Utils;
using RaidReview.Config;
using RaidReview.Database;
using RaidReview.DataIntegrity;
using RaidReview.FileSystem;
using RaidReview.Http;
using RaidReview.PostRaid;
using RaidReview.Session;
using RaidReview.WebSocket;
using System.Reflection;

namespace RaidReview;

[Injectable(InjectionType = InjectionType.Singleton, TypePriority = OnLoadOrder.PreSptModLoader + 1)]
public class RaidReviewMod : IOnLoad
{
    private readonly ISptLogger<RaidReviewMod> _sptLogger;

    public RaidReviewMod(ISptLogger<RaidReviewMod> sptLogger)
    {
        _sptLogger = sptLogger;
    }

    public async Task OnLoad()
    {
        _sptLogger.Info("[RAID-REVIEW] Initializing Raid Review mod...");

        // Locate mod folder (same directory as this DLL)
        var modFolder = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location)
            ?? AppContext.BaseDirectory;

        var dataFolder = Path.Combine(modFolder, "data");

        // Load config
        var config = RaidReviewConfig.Load(modFolder);
        _sptLogger.Info($"[RAID-REVIEW] Config loaded. WS port: {config.WebSocketPort}, HTTP port: {config.WebClientPort}");

        // Logger - wrap ISptLogger methods as Action<string> delegates to avoid generic type issues
        var logger = new RaidReviewLogger();
        logger.Initialize(
            msg => _sptLogger.Info(msg),
            msg => _sptLogger.Debug(msg),
            msg => _sptLogger.Warning(msg),
            msg => _sptLogger.Error(msg),
            dataFolder,
            config);
        logger.Log("Raid Review mod loading...");

        // Database
        var db = new DatabaseService();
        await db.InitializeAsync(dataFolder);
        logger.Log("Database initialized.");

        // File service
        var fileService = new DataFileService();
        fileService.Initialize(dataFolder);

        // Session manager
        var sessionManager = new SessionManager(logger, config);

        // Post-raid compiler
        var compiler = new RaidPositionCompiler(fileService, logger);

        // Garbage collector
        var gc = new GarbageCollector(db, fileService, logger, config);
        await gc.CollectOldRaidsAsync();
        await gc.CollectUnfinishedRaidsAsync();

        // Set up post-processing (runs after each raid ends)
        Timer? postProcessTimer = null;
        var raidsToProcess = new HashSet<string>();

        void StartPostProcessing(string raidId)
        {
            raidsToProcess.Add(raidId);
            postProcessTimer?.Dispose();
            postProcessTimer = new Timer(_ =>
            {
                if (raidsToProcess.Count > 0)
                {
                    foreach (var id in raidsToProcess.ToArray())
                    {
                        compiler.Compile(id);
                        raidsToProcess.Remove(id);
                    }
                    postProcessTimer?.Dispose();
                    logger.Log("Post-raid processing completed.");
                }
            }, null, TimeSpan.FromSeconds(60), TimeSpan.FromSeconds(60));
        }

        void StopPostProcessing()
        {
            postProcessTimer?.Dispose();
            postProcessTimer = null;
        }

        // WebSocket packet handler
        var wsHandler = new WsPacketHandler(db, sessionManager, fileService, logger);
        wsHandler.SetPostProcessingCallbacks(StartPostProcessing, StopPostProcessing);

        // Hourly garbage collection if configured
        if (config.AutoDeleteCronJob)
        {
            var gcTimer = new Timer(async _ =>
            {
                await gc.CollectOldRaidsAsync();
                await gc.CollectUnfinishedRaidsAsync();
            }, null, TimeSpan.FromHours(1), TimeSpan.FromHours(1));
        }

        // Start the web server (HTTP + WebSocket) on background thread
        var webServer = new RaidReviewWebServer(config, db, fileService, logger, wsHandler, compiler, modFolder);
        _ = Task.Run(async () =>
        {
            try
            {
                await webServer.StartAsync();
            }
            catch (Exception ex)
            {
                logger.Error("Failed to start web server", ex);
            }
        });

        logger.Log("Raid Review mod loaded successfully.");
        _sptLogger.Info("[RAID-REVIEW] Mod loaded successfully.");
    }
}
