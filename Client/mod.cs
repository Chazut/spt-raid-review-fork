using EFT;
using System;
using System.Diagnostics;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using BepInEx;
using UnityEngine;
using Comfort.Common;
using Newtonsoft.Json;
using BepInEx.Configuration;
using System.IO;
using System.Reflection;
using System.Numerics;
using Vector3 = UnityEngine.Vector3;
using BepInEx.Bootstrap;
using EFT.Communications;
using System.Threading.Tasks;
using System.Linq;
using System.Collections;
using EFT.HealthSystem;

namespace RAID_REVIEW
{
    [BepInPlugin("ekky.raidreview", "Raid Review", "0.5.1")]
    [BepInDependency("me.sol.sain", BepInDependency.DependencyFlags.SoftDependency)]
    public class RAID_REVIEW : BaseUnityPlugin
    {
        // Framerate
        public static float PlayerTrackingInterval = 5f;

        // RAID_REVIEW
        public static string sessionId = null;
        public static bool inRaid = false;
        public static bool tracking = false;
        public static bool WebSocketConnected = false;
        public static string RAID_REVIEW_WS_Server = "ws://127.0.0.1:7828";
        public static string RAID_REVIEW_HTTP_Server = "http://127.0.0.1:7829";
        public static List<string> RAID_REVIEW__DETECTED_MODS = new List<string>();
        public static Dictionary<string, TrackingPlayer> trackingPlayers = new Dictionary<string, TrackingPlayer>();
        public static TrackingRaid trackingRaid = new TrackingRaid();
        public static Stopwatch stopwatch = new Stopwatch();

        // EFT
        public static GameWorld gameWorld;
        public static RaidSettings raid;
        public static Player myPlayer;

        // BepInEx
        public static ConfigEntry<KeyboardShortcut> LaunchWebpageKey;
        public static ConfigEntry<bool> PlayerTracking;
        public static ConfigEntry<bool> InsertMenuItem;
        public static ConfigEntry<bool> RecordingNotification;
        public static ConfigEntry<bool> KillTracking;
        public static ConfigEntry<bool> LootTracking;
        public static ConfigEntry<bool> BallisticsTracking;
        public static ConfigEntry<string> ServerAddress;
        public static ConfigEntry<string> ServerWsPort;
        public static ConfigEntry<string> ServerHttpPort;
        public static ConfigEntry<bool> EnableRecording;
        public static ConfigEntry<bool> ServerTLS;
        public static GameObject Hook;

        /// <summary>
        /// Maps a WildSpawnType to a Raid Review display string ("NAME|CATEGORY").
        /// Used as a fallback when SAIN is not installed.
        /// </summary>
        public static string MapWildSpawnType(WildSpawnType role)
        {
            switch (role.ToString())
            {
                case "assault": return "SCAV|SCAV";
                case "assaultGroup": return "SCAV GROUP|SCAV";
                case "marksman": return "SCAV SNIPER|SNIPER";
                case "cursedAssault": return "TAGGED AND CURSED SCAV|SCAV";
                case "bossKnight": return "KNIGHT|GOON";
                case "followerBigPipe": return "BIGPIPE|GOON";
                case "followerBirdEye": return "BIRDEYE|GOON";
                case "exUsec": return "ROGUE|FOLLOWER";
                case "pmcBot": return "RAIDER|FOLLOWER";
                case "arenaFighterEvent": return "BLOODHOUND|BLOODHOUND";
                case "sectantPriest": return "CULTIST PRIEST|CULT";
                case "sectantWarrior": return "CULTIST|CULT";
                case "bossKilla": return "KILLA|BOSS";
                case "bossBully": return "RASHALA|BOSS";
                case "followerBully": return "RASHALA GUARD|FOLLOWER";
                case "bossKojaniy": return "SHTURMAN|BOSS";
                case "followerKojaniy": return "SHTURMAN GUARD|FOLLOWER";
                case "bossTagilla": return "TAGILLA|BOSS";
                case "followerTagilla": return "TAGILLA GUARD|FOLLOWER";
                case "bossSanitar": return "SANITAR|BOSS";
                case "followerSanitar": return "SANITAR GUARD|FOLLOWER";
                case "bossGluhar": return "GLUHAR|BOSS";
                case "followerGluharSnipe": return "GLUHAR GUARD SNIPE|FOLLOWER";
                case "followerGluharScout": return "GLUHAR GUARD SCOUT|FOLLOWER";
                case "followerGluharSecurity": return "GLUHAR GUARD SECURITY|FOLLOWER";
                case "followerGluharAssault": return "GLUHAR GUARD ASSAULT|FOLLOWER";
                case "bossZryachiy": return "ZRYACHIY|BOSS";
                case "followerZryachiy": return "ZRYACHIY GUARD|FOLLOWER";
                case "bossBoar": return "KABAN|BOSS";
                case "followerBoar": return "KABAN GUARD|FOLLOWER";
                case "bossBoarSniper": return "KABAN SNIPER|FOLLOWER";
                case "bossKolontay": return "KOLONTAY|BOSS";
                case "followerKolontayAssault": return "KOLONTAY ASSAULT|FOLLOWER";
                case "followerKolontaySecurity": return "KOLONTAY SECURITY|FOLLOWER";
                case "bossPartisan": return "PARTIZAN|BOSS";
                case "shooterBTR": return "BTR|OTHER";
                // Labyrinth
                case "bossTagillaAgro": return "SHADOW TAGILLA|BOSS";
                case "bossKillaAgro": return "VENGEFUL KILLA|BOSS";
                case "tagillaHelperAgro": return "SHADOW TAGILLA GUARD|FOLLOWER";
                case "infectedAssault": return "INFECTED|INFECTED";
                case "infectedPmc": return "INFECTED PMC|INFECTED";
                case "infectedCivil": return "INFECTED CIVILIAN|INFECTED";
                case "infectedLaborant": return "INFECTED LABORANT|INFECTED";
                case "infectedTagilla": return "INFECTED TAGILLA|BOSS";
                case "spiritWinter": return "SPIRIT WINTER|SPECIAL";
                case "spiritSpring": return "SPIRIT SPRING|SPECIAL";
                // PMC bots
                case "pmcBEAR": return "PMC|BEAR";
                case "pmcUSEC": return "PMC|USEC";
                case "sptBear": return "PMC|BEAR";
                case "sptUsec": return "PMC|USEC";
                // Custom faction mods
                case "mercenary": return "MERCENARY|MERCENARY";
                case "ruafRifleman": return "RUAF RIFLEMAN|RUAF";
                case "ruafRiflemanSenior": return "RUAF SENIOR RIFLEMAN|RUAF";
                case "ruafAutorifleman": return "RUAF AUTORIFLEMAN|RUAF";
                case "ruafGrenadier": return "RUAF GRENADIER|RUAF";
                case "ruafMarksman": return "RUAF MARKSMAN|RUAF";
                case "ruafMachinegunner": return "RUAF MACHINEGUNNER|RUAF";
                case "followeruntar": return "UNTAR GUARD|UNTAR";
                case "bossuntarlead": return "UNTAR SQUAD LEADER|UNTAR";
                case "followeruntarmarksman": return "UNTAR MARKSMAN|UNTAR";
                case "bossuntarofficer": return "UNTAR OFFICER|UNTAR";
                case "blackDivLead": return "BLACK DIV LEAD|BLACKDIV";
                case "blackDivAssault": return "BLACK DIV ASSAULT|BLACKDIV";
                case "blackDivBreacher": return "BLACK DIV BREACHER|BLACKDIV";
                case "blackDivSupport": return "BLACK DIV SUPPORT|BLACKDIV";
                default: return role.ToString().ToUpper() + "|FACTION_MOD";
            }
        }

        // Other Mods
        public static bool MODS_SEARCHED = false;
        public static bool SOLARINT_SAIN__DETECTED { get; set; }
        public static object sainBotController { get; set; }
        public static bool searchingForSainComponents = false;
        public static Dictionary<string, TrackingPlayer> updatedBots = new Dictionary<string, TrackingPlayer>();

        // SAIN reflection cache
        private static bool _sainReflectionInit = false;
        private static bool _sainAvailable = false;
        private static Type _sainBotComponentType;
        private static PropertyInfo _sainActiveLayerProp;
        private static PropertyInfo _sainDecisionProp;
        private static PropertyInfo _sainCombatDecProp;
        private static PropertyInfo _sainSelfDecProp;
        private static PropertyInfo _sainSquadDecProp;

        private static void InitSainReflection()
        {
            if (_sainReflectionInit) return;
            _sainReflectionInit = true;
            try
            {
                var sainAssembly = AppDomain.CurrentDomain.GetAssemblies()
                    .FirstOrDefault(a => a.GetName().Name == "SAIN");
                if (sainAssembly == null) return;

                _sainBotComponentType = sainAssembly.GetType("SAIN.Components.BotComponent");
                if (_sainBotComponentType == null) return;

                _sainActiveLayerProp = _sainBotComponentType.GetProperty("ActiveLayer");
                _sainDecisionProp = _sainBotComponentType.GetProperty("Decision");

                if (_sainDecisionProp != null)
                {
                    var decClassType = _sainDecisionProp.PropertyType;
                    _sainCombatDecProp = decClassType?.GetProperty("CurrentCombatDecision");
                    _sainSelfDecProp = decClassType?.GetProperty("CurrentSelfDecision");
                    _sainSquadDecProp = decClassType?.GetProperty("CurrentSquadDecision");
                }

                _sainAvailable = true;
            }
            catch { }
        }

        private static string GetSainDecision(Player player)
        {
            if (!_sainAvailable || _sainBotComponentType == null) return null;

            try
            {
                var botComp = player.gameObject.GetComponent(_sainBotComponentType);
                if (botComp == null) return null;

                if (_sainDecisionProp != null)
                {
                    var decisionObj = _sainDecisionProp.GetValue(botComp);
                    if (decisionObj != null)
                    {
                        // Self decisions (FirstAid, Reload, Surgery, Stims) take priority
                        if (_sainSelfDecProp != null)
                        {
                            var selfDec = _sainSelfDecProp.GetValue(decisionObj)?.ToString();
                            if (!string.IsNullOrEmpty(selfDec) && selfDec != "None" && selfDec != "0")
                                return "SAIN:" + selfDec;
                        }

                        // Combat decisions (Search, StandAndShoot, DogFight, etc.)
                        if (_sainCombatDecProp != null)
                        {
                            var combatDec = _sainCombatDecProp.GetValue(decisionObj)?.ToString();
                            if (!string.IsNullOrEmpty(combatDec) && combatDec != "None" && combatDec != "0")
                                return "SAIN:" + combatDec;
                        }

                        // Squad decisions (Regroup, Suppress, Help, etc.)
                        if (_sainSquadDecProp != null)
                        {
                            var squadDec = _sainSquadDecProp.GetValue(decisionObj)?.ToString();
                            if (!string.IsNullOrEmpty(squadDec) && squadDec != "None" && squadDec != "0")
                                return "SAIN:" + squadDec;
                        }
                    }
                }

                // Fallback to active layer name (Combat, Peace, Extract, etc.)
                if (_sainActiveLayerProp != null)
                {
                    var layer = _sainActiveLayerProp.GetValue(botComp)?.ToString();
                    if (!string.IsNullOrEmpty(layer) && layer != "None" && layer != "0")
                        return "SAIN:" + layer;
                }
            }
            catch { }

            return null;
        }

        void Awake()
        {
            Logger.LogInfo("RAID_REVIEW :::: INFO :::: Mod Loaded");

            // Clean up legacy versioned DLLs (e.g. RAID_REVIEW__0.4.0.dll) from older releases
            try
            {
                var dllPath = System.Reflection.Assembly.GetExecutingAssembly().Location;
                var pluginDir = System.IO.Path.GetDirectoryName(dllPath);
                Logger.LogInfo($"RAID_REVIEW :::: INFO :::: Plugin directory: {pluginDir}");
                if (pluginDir != null)
                {
                    foreach (var old in System.IO.Directory.GetFiles(pluginDir, "RAID_REVIEW*.dll"))
                    {
                        if (string.Equals(old, dllPath, System.StringComparison.OrdinalIgnoreCase)) continue;
                        Logger.LogInfo($"RAID_REVIEW :::: INFO :::: Removing legacy DLL: {System.IO.Path.GetFileName(old)}");
                        System.IO.File.Delete(old);
                    }
                }
            }
            catch (System.Exception ex)
            {
                Logger.LogWarning($"RAID_REVIEW :::: WARN :::: Failed to clean up legacy DLLs: {ex.Message}");
            }

            // Configuration Bindings
            LaunchWebpageKey = Config.Bind("Main", "Open Webpage Keybind", new KeyboardShortcut(KeyCode.F5), "Keybind to open the web client.");
            InsertMenuItem = Config.Bind<bool>("Main", "Insert Menu Item", false, "Enables menu item to open the web client.");
            RecordingNotification = Config.Bind<bool>("Main", "Recording Notification", true, "Enables notifications as recording starts and ends.");

            ServerAddress = Config.Bind<string>("Server", "1. Server IP", "127.0.0.1", "IP address of the server.");
            ServerWsPort = Config.Bind<string>("Server", "2. Server WS Port", "7828", "Listen port of the raid review websocket server.");
            ServerHttpPort = Config.Bind<string>("Server", "3. Server HTTP Port", "7829", "Listen port of the raid review http server.");
            ServerTLS = Config.Bind<bool>("Server", "4. TLS", false, "Enable if you are using an SSL Certificate infront of your http server.");
            EnableRecording = Config.Bind<bool>("Server", "5. Enable Recording", true, "[WARNING] Only disable if you want to stop all data from being sent to raid review, requires restart.");

            PlayerTracking = Config.Bind<bool>("Tracking Settings", "Player Tracking", true, "Enables location tracking of players and bots.");
            KillTracking = Config.Bind<bool>("Tracking Settings", "Kill Tracking", true, "Enables location tracking of kills.");
            LootTracking = Config.Bind<bool>("Tracking Settings", "Loot Tracking", true, "Enables location tracking of lootings.");
            BallisticsTracking = Config.Bind<bool>("Tracking Settings", "Ballistics Tracking", true, "Enables location tracking of ballistics.");

            // HTTP/Websocket Endpoint Builders
            RAID_REVIEW_WS_Server = "ws://" + ServerAddress.Value + ":" + ServerWsPort.Value;
            RAID_REVIEW_HTTP_Server = (ServerTLS.Value ? "https://" : "http://") + ServerAddress.Value + ":" + ServerHttpPort.Value;

            Hook = new GameObject();

            Logger.LogInfo("RAID_REVIEW :::: INFO :::: Config Loaded");
            new RAID_REVIEW_Player_OnGameStartedPatch().Enable();
            new RAID_REVIEW_Player_OnGameSessionEndPatch().Enable();
            new RAID_REVIEW_menuTaskBar_setButtonsAvailablePatch().Enable();
            new RAID_REVIEW_Player_OnBeenKilledByAggressorPatch().Enable();
            new RAID_REVIEW_Player_OnItemAddedOrRemovedPatch().Enable();
            new RAID_REVIEW_ClientGameWorld_ShotDelegatePatch().Enable();
            Logger.LogInfo("RAID_REVIEW :::: INFO :::: Patches Loaded");

            Telemetry.Connect(RAID_REVIEW_WS_Server);
            Logger.LogInfo("RAID_REVIEW :::: INFO :::: Connected to backend");

            LoggerInstance.Log = Logger;

            StartCoroutine(UpdateCoroutine());
        }
        IEnumerator UpdateCoroutine()
        {
            while (true)
            {
                yield return new WaitForSeconds(1.0f / PlayerTrackingInterval);

                try
                {

                    if (Input.GetKey(LaunchWebpageKey.Value.MainKey))
                    {
                        Application.OpenURL(RAID_REVIEW_HTTP_Server);

                    }

                    // IF MAP NOT LOADED, RETURN
                    if (!MapLoaded())
                        continue;

                    gameWorld = Singleton<GameWorld>.Instance;
                    myPlayer = gameWorld?.MainPlayer;

                    // IF IN MENU, RETURN
                    if (gameWorld == null || myPlayer == null || gameWorld.LocationId == "hideout")
                    {
                        continue;
                    }

                    if (sessionId == null && gameWorld != null && myPlayer != null && gameWorld.CurrentProfileId != null)
                    {
                        sessionId = gameWorld.CurrentProfileId.ToString();
                    }

                    // IF RAID HAS NOT STARTED, RETURN
                    if (!inRaid)
                    {
                        continue;
                    }

                    // PLAYER TRACKING LOOP
                    IEnumerable<Player> allPlayers = gameWorld.AllPlayersEverExisted;
                    long captureTime = stopwatch.ElapsedMilliseconds;
                    foreach (Player player in allPlayers)
                    {

                        if (player == null)
                            continue;

                        TrackingPlayer trackingPlayer = new TrackingPlayer();
                        bool isBeingTracked = trackingPlayers.TryGetValue(player.ProfileId, out trackingPlayer);
                        if (!isBeingTracked)
                        {

                            trackingPlayer = new TrackingPlayer
                            {
                                sessionId = sessionId,
                                profileId = player.ProfileId,
                                name = player.Profile.Nickname,
                                level = player.Profile.Info.Level,
                                team = player.Side,
                                group = player?.AIData?.BotOwner?.BotsGroup?.Id ?? 0,
                                spawnTime = stopwatch.ElapsedMilliseconds,
                                type = player.IsAI ? "BOT" : "HUMAN",
                                mod_SAIN_brain = "UNKNOWN",
                                mod_SAIN_difficulty = ""
                            };

                            if (player.Side == EPlayerSide.Savage)
                            {
                                trackingPlayer.mod_SAIN_brain = "SCAV";
                                trackingPlayer.type = "SCAV|SCAV";
                            }
                            else if (player.Side == EPlayerSide.Usec || player.Side == EPlayerSide.Bear)
                            {
                                trackingPlayer.mod_SAIN_brain = "PMC";
                            }

                            // Read WildSpawnType directly for bot type detection
                            // Must run for all AI (including Savage side) to detect bosses like Partizan
                            if (player.IsAI)
                            {
                                try
                                {
                                    var role = player.Profile.Info.Settings.Role;
                                    trackingPlayer.type = MapWildSpawnType(role);
                                    // Override cyrillic names for known bosses
                                    if (role.ToString() == "bossPartisan") trackingPlayer.name = "Partizan";
                                }
                                catch { }
                            }

                            trackingPlayers[trackingPlayer.profileId] = trackingPlayer;
                            _ = Telemetry.Send("PLAYER", JsonConvert.SerializeObject(trackingPlayer));

                        }

                        // Checks if a player / bot has died since the last check...
                        if (player.HealthController.IsAlive)
                        {

                            if (PlayerTracking.Value)
                            {

                                if (player == null || gameWorld == null)
                                {
                                    Logger.LogWarning("Player or gameWorld is null, skipping this iteration.");
                                    continue;

                                }

                                Vector3 playerPosition = player.Position;

                                if (playerPosition == null)
                                {
                                    Logger.LogWarning("Player position is null, skipping this iteration.");
                                    continue;

                                }

                                Vector3 playerFacing = player.LookDirection;

                                if (playerFacing == null)
                                {
                                    Logger.LogWarning("Player look direction is null, skipping this iteration.");
                                    continue;

                                }

                                Vector3 playerDirection = playerPosition - playerFacing;

                                playerDirection.Normalize();
                                Vector3 referenceVector = new Vector3(0, 0, 1);
                                referenceVector.Normalize();

                                float dotProduct = Vector3.Dot(playerDirection, referenceVector);
                                float angle = Mathf.Acos(dotProduct) * Mathf.Rad2Deg;
                                float dir = angle;

                                // Health Data
                                ValueStruct commonHealth = player.HealthController.GetBodyPartHealth(EBodyPart.Common, true);
                                float currentHealth = commonHealth.Current;
                                float currentHealthMaximum = commonHealth.Current;

                                // Bot behavior state
                                string decision = "";
                                if (player.IsAI)
                                {
                                    try
                                    {
                                        InitSainReflection();

                                        // Try SAIN reflection first for meaningful decision names
                                        var sainDec = GetSainDecision(player);
                                        if (!string.IsNullOrEmpty(sainDec))
                                        {
                                            decision = sainDec;
                                        }
                                        else
                                        {
                                            // Vanilla fallback — skip BigBrain custom IDs (>= 9000)
                                            var botOwner = player.AIData?.BotOwner;
                                            if (botOwner?.Brain != null)
                                            {
                                                var lastDecision = botOwner.Brain.LastDecision;
                                                if (lastDecision.HasValue && (int)lastDecision.Value < 9000)
                                                    decision = lastDecision.Value.ToString();
                                            }
                                        }
                                    }
                                    catch { }
                                }

                                var trackingPlayerData = new TrackingPlayerData(sessionId, player.ProfileId, captureTime, playerPosition.x, playerPosition.y, playerPosition.z, dir, currentHealth, currentHealthMaximum, decision);
                                _ = Telemetry.Send("POSITION", JsonConvert.SerializeObject(trackingPlayerData));
                            }

                        }

                    }

                }

                catch (Exception ex)
                {
                    Logger.LogError(ex);
                    Logger.LogError($"{ex.Message}");
                }
            }
        }
        public static bool DetectMod(string modName)
        {
            if (Chainloader.PluginInfos.ContainsKey(modName)) return true;
            return false;
        }
        public static bool MapLoaded() => Singleton<GameWorld>.Instantiated;

    }
}