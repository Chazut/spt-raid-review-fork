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
using EFT.InventoryLogic;
using EFT.Interactive;

namespace RAID_REVIEW
{
    [BepInPlugin("ekky.raidreview", "Raid Review", "1.6.1")]
    [BepInDependency("me.sol.sain", BepInDependency.DependencyFlags.SoftDependency)]
    [BepInDependency("com.danw.questingbots", BepInDependency.DependencyFlags.SoftDependency)]
    [BepInDependency("com.janky.phobos", BepInDependency.DependencyFlags.SoftDependency)]
    [BepInDependency("com.chazut.orbit", BepInDependency.DependencyFlags.SoftDependency)]
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

        // Opt-out toggles for unsupported legacy mod integrations. Default ON
        // so users with these mods still get telemetry, but they're behind a
        // disclaimer-bearing toggle so users without them (or who see errors)
        // can disable cleanly. Both use reflection against mods that don't
        // expose a public API — no support guarantees.
        public static ConfigEntry<bool> EnableLegacyPhobos;
        public static ConfigEntry<bool> EnableLegacyQuestingBots;
        public static GameObject Hook;

        /// <summary>
        /// MoreBotsAPI "hunt" squads (e.g. UNTAR Go Home raider hunts on Woods/Customs) spawn as plain
        /// pmcBot with no custom role, so role mapping alone shows them as vanilla Raiders. The API's own
        /// discriminator is the spawn id: SpawnParams.Id_spawn contains "hunt" (see MoreBotsAPI
        /// HuntManager.OnBotCreated). Same check here.
        /// </summary>
        public static bool IsHuntSpawn(Player player)
        {
            try
            {
                var idSpawn = player?.AIData?.BotOwner?.SpawnProfileData?.SpawnParams?.Id_spawn;
                return idSpawn != null && idSpawn.ToLower().Contains("hunt");
            }
            catch
            {
                return false;
            }
        }

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
                // RUAF Hardcore - Remnant faction
                case "remnantRifleman": return "REMNANT RIFLEMAN|RUAF";
                case "remnantRiflemanSenior": return "REMNANT SENIOR RIFLEMAN|RUAF";
                case "remnantAutorifleman": return "REMNANT AUTORIFLEMAN|RUAF";
                case "remnantGrenadier": return "REMNANT GRENADIER|RUAF";
                case "remnantMarksman": return "REMNANT MARKSMAN|RUAF";
                case "remnantMachinegunner": return "REMNANT MACHINEGUNNER|RUAF";
                case "followeruntar": return "UNTAR GUARD|UNTAR";
                case "bossuntarlead": return "UNTAR SQUAD LEADER|UNTAR";
                case "followeruntarmarksman": return "UNTAR MARKSMAN|UNTAR";
                case "bossuntarofficer": return "UNTAR OFFICER|UNTAR";
                case "blackDivLead": return "BLACK DIV LEAD|BLACKDIV";
                case "blackDivAssault": return "BLACK DIV ASSAULT|BLACKDIV";
                case "blackDivBreacher": return "BLACK DIV BREACHER|BLACKDIV";
                case "blackDivSupport": return "BLACK DIV SUPPORT|BLACKDIV";
                // ISB faction mod. Custom WildSpawnType member names (role.ToString() yields the
                // member name for these, same as the other faction mods above). Future Firefly squad
                // members are mapped ahead of the mod shipping them.
                case "ISBSpecialForces": return "ISB SPECIAL FORCES|ISB";
                case "ISBTeamLeader": return "ISB TEAM LEADER|ISB";
                case "ISBSecondLeader": return "ISB SECOND LEADER|ISB";
                case "ISBFirefly": return "ISB FIREFLY|ISB";
                case "ISBFireflyFollowerLoghan": return "ISB FIREFLY LOGHAN|ISB";
                case "ISBFireflyFollowerVipper": return "ISB FIREFLY VIPPER|ISB";
                case "ISBFireflyShielder01": return "ISB FIREFLY SHIELDER 1|ISB";
                case "ISBFireflyShielder02": return "ISB FIREFLY SHIELDER 2|ISB";
                // ISB 1.0 "White Tusk" commander duo (enum values 13707/13708) — display name per Firefly.
                case "ISBBossCommander": return "WHITE TUSK|ISB";
                case "ISBFollowerCommander": return "WHITE TUSK|ISB";
                // Wedge boss mod (prepatch pins wedge=848430 / wedgeguard=848431 into the enum)
                case "wedge": return "WEDGE|BOSS";
                case "wedgeguard": return "WEDGE GUARD|FOLLOWER";
                // Manimal's Combine Soldiers
                case "CombineSoldier": return "COMBINE SOLDIER|COMBINE";
                case "CombineShotgunner": return "COMBINE SHOTGUNNER|COMBINE";
                case "CombineElite": return "COMBINE ELITE|COMBINE";
                default: return role.ToString().ToUpper() + "|FACTION_MOD";
            }
        }

        // Other Mods
        public static bool MODS_SEARCHED = false;
        public static bool SOLARINT_SAIN__DETECTED { get; set; }
        public static bool DANW_QUESTINGBOTS__DETECTED { get; set; }
        // Upstream Phobos (com.janky.phobos) — legacy integration in
        // Phobos_Integration. Gated by EnableLegacyPhobos (default OFF).
        public static bool PHOBOS_LEGACY__DETECTED { get; set; }
        // ORBIT (com.chazut.orbit) — the supported AI integration.
        // Reflection target is the Orbit assembly, types Orbit.Core.*.
        public static bool ORBIT__DETECTED { get; set; }
        public static object sainBotController { get; set; }
        public static bool searchingForSainComponents = false;
        public static Dictionary<string, TrackingPlayer> updatedBots = new Dictionary<string, TrackingPlayer>();
        // QuestingBots: cache last sent quest+status per bot to avoid spamming unchanged data
        public static Dictionary<string, string> _lastBotQuestState = new Dictionary<string, string>();
        // Phobos: cache last sent objective state per bot to avoid spamming unchanged data
        public static Dictionary<string, string> _lastBotObjectiveState = new Dictionary<string, string>();
        // Debug: log unique BigBrain layer names seen during the raid
        private static HashSet<string> _seenLayerNames = new HashSet<string>();

        // SAIN reflection cache
        private static bool _sainReflectionInit = false;
        private static bool _sainAvailable = false;
        private static Type _sainBotComponentType;
        private static Type _sainBotControllerType;
        private static PropertyInfo _sainActiveLayerProp;
        private static PropertyInfo _sainDecisionProp;
        private static PropertyInfo _sainCombatDecProp;
        private static PropertyInfo _sainSelfDecProp;
        private static PropertyInfo _sainSquadDecProp;
        private static PropertyInfo _sainCurrentActionProp;
        private static PropertyInfo _sainActionNameProp;
        private static PropertyInfo _sainBotsProp;
        private static PropertyInfo _sainBotPlayerProp;
        private static PropertyInfo _sainBotProfileIdProp;
        private static PropertyInfo _sainMoverProp;
        private static PropertyInfo _sainMoverMovingProp;
        private static PropertyInfo _sainMoverSprintProp;
        private static PropertyInfo _sainStandByProp;
        private static PropertyInfo _sainLayersActiveProp;

        private static void InitSainReflection()
        {
            if (_sainReflectionInit) return;
            _sainReflectionInit = true;
            try
            {
                _sainBotComponentType = Type.GetType("SAIN.Components.BotComponent, SAIN");
                _sainBotControllerType = Type.GetType("SAIN.Components.BotManagerComponent, SAIN");

                if (_sainBotComponentType == null)
                {
                    LoggerInstance.Log.LogWarning("RAID_REVIEW :::: SAIN :::: BotComponent type not found");
                    return;
                }

                _sainActiveLayerProp = _sainBotComponentType.GetProperty("ActiveLayer");
                _sainDecisionProp = _sainBotComponentType.GetProperty("Decision");
                _sainCurrentActionProp = _sainBotComponentType.GetProperty("CurrentAction");
                _sainBotPlayerProp = _sainBotComponentType.GetProperty("Player");

                if (_sainDecisionProp != null)
                {
                    var decClassType = _sainDecisionProp.PropertyType;
                    _sainCombatDecProp = decClassType?.GetProperty("CurrentCombatDecision");
                    _sainSelfDecProp = decClassType?.GetProperty("CurrentSelfDecision");
                    _sainSquadDecProp = decClassType?.GetProperty("CurrentSquadDecision");
                }

                if (_sainCurrentActionProp != null)
                {
                    _sainActionNameProp = _sainCurrentActionProp.PropertyType?.GetProperty("Name");
                }

                if (_sainBotControllerType != null)
                {
                    _sainBotsProp = _sainBotControllerType.GetProperty("Bots");
                }

                if (_sainBotPlayerProp != null)
                {
                    _sainBotProfileIdProp = _sainBotPlayerProp.PropertyType?.GetProperty("ProfileId");
                }

                // Movement/state properties for peace mode granularity
                _sainMoverProp = _sainBotComponentType.GetProperty("Mover");
                _sainStandByProp = _sainBotComponentType.GetProperty("BotInStandBy");
                _sainLayersActiveProp = _sainBotComponentType.GetProperty("SAINLayersActive");

                if (_sainMoverProp != null)
                {
                    var moverType = _sainMoverProp.PropertyType;
                    _sainMoverMovingProp = moverType?.GetProperty("Moving");
                    _sainMoverSprintProp = moverType?.GetProperty("SprintController");
                    // Try "Running" as fallback
                    if (_sainMoverSprintProp == null)
                        _sainMoverSprintProp = moverType?.GetProperty("Running");
                }

                _sainAvailable = true;

                LoggerInstance.Log.LogInfo($"RAID_REVIEW :::: SAIN :::: Reflection init OK — " +
                    $"Decision={_sainDecisionProp != null}, Combat={_sainCombatDecProp != null}, " +
                    $"Self={_sainSelfDecProp != null}, Squad={_sainSquadDecProp != null}, " +
                    $"Action={_sainCurrentActionProp != null}, ActionName={_sainActionNameProp != null}, " +
                    $"ActiveLayer={_sainActiveLayerProp != null}, " +
                    $"Controller={_sainBotControllerType != null}, Bots={_sainBotsProp != null}, " +
                    $"Mover={_sainMoverProp != null}, Moving={_sainMoverMovingProp != null}, " +
                    $"StandBy={_sainStandByProp != null}, LayersActive={_sainLayersActiveProp != null}");
            }
            catch (Exception ex)
            {
                LoggerInstance.Log.LogWarning($"RAID_REVIEW :::: SAIN :::: Reflection init failed: {ex.Message}");
            }
        }

        // Cache: profileId → SAIN BotComponent (rebuilt each position tick)
        private static Dictionary<string, object> _sainBotCache = new Dictionary<string, object>();

        private static void RefreshSainBotCache()
        {
            _sainBotCache.Clear();
            try
            {
                // Use the already-discovered sainBotController from SAIN_Integration
                var controller = RAID_REVIEW.sainBotController;
                if (controller == null || _sainBotsProp == null) return;

                var bots = _sainBotsProp.GetValue(controller);
                if (bots == null) return;

                var botValues = (IEnumerable)bots.GetType().GetProperty("Values")?.GetValue(bots);
                if (botValues == null) return;

                foreach (var botComp in botValues)
                {
                    try
                    {
                        string profileId = null;
                        if (_sainBotPlayerProp != null)
                        {
                            var playerObj = _sainBotPlayerProp.GetValue(botComp);
                            if (playerObj != null && _sainBotProfileIdProp != null)
                                profileId = _sainBotProfileIdProp.GetValue(playerObj)?.ToString();
                        }
                        if (!string.IsNullOrEmpty(profileId))
                            _sainBotCache[profileId] = botComp;
                    }
                    catch { }
                }
            }
            catch { }
        }

        private static string ExtractDecisionFromBotComp(object botComp)
        {
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

            // CurrentAction.Name
            if (_sainCurrentActionProp != null && _sainActionNameProp != null)
            {
                var actionObj = _sainCurrentActionProp.GetValue(botComp);
                if (actionObj != null)
                {
                    var actionName = _sainActionNameProp.GetValue(actionObj)?.ToString();
                    if (!string.IsNullOrEmpty(actionName))
                        return "SAIN:" + actionName;
                }
            }

            // Fallback to active layer name (Combat, Peace, Extract, etc.)
            if (_sainActiveLayerProp != null)
            {
                var layer = _sainActiveLayerProp.GetValue(botComp)?.ToString();
                if (!string.IsNullOrEmpty(layer) && layer != "None" && layer != "0")
                    return "SAIN:" + layer;
            }

            // Bot is managed by SAIN but all decisions are "None" — check movement state
            try
            {
                // Check if bot is in AI-limiter standby (not actually doing anything)
                if (_sainStandByProp != null)
                {
                    var standBy = _sainStandByProp.GetValue(botComp);
                    if (standBy is true)
                        return "standBy";
                }

                // Check Mover.Moving to distinguish patrol from idle
                if (_sainMoverProp != null && _sainMoverMovingProp != null)
                {
                    var mover = _sainMoverProp.GetValue(botComp);
                    if (mover != null)
                    {
                        var moving = _sainMoverMovingProp.GetValue(mover);
                        if (moving is true)
                            return "simplePatrol";
                    }
                }
            }
            catch { }

            // Vanilla states (peaceful/simplePatrol/standBy) are reported without the "SAIN:" prefix.
            return "peaceful";
        }

        private static bool IsIdleOrPatrolDecision(string decision)
            => string.IsNullOrEmpty(decision)
               || decision == "peaceful" || decision == "simplePatrol" || decision == "standBy"
               || decision == "SAIN:Peace";

        private static string GetSainDecision(Player player)
        {
            if (!_sainAvailable) return null;

            try
            {
                // Primary: lookup from BotManagerComponent.Bots dictionary (populated by SAIN_Integration)
                if (_sainBotCache.TryGetValue(player.ProfileId, out var cachedComp))
                {
                    var result = ExtractDecisionFromBotComp(cachedComp);
                    if (result != null) return result;
                }

                // Fallback: try GetComponent directly on player's gameObject
                if (_sainBotComponentType != null)
                {
                    var botComp = player.gameObject.GetComponent(_sainBotComponentType);
                    if (botComp != null)
                    {
                        var result = ExtractDecisionFromBotComp(botComp);
                        if (result != null) return result;
                    }
                }
            }
            catch { }

            return null;
        }

        /// <summary>Get handbook base price for an item (0 if handbook unavailable).</summary>
        public static int GetHandbookPrice(Item item)
        {
            try { return (int)Singleton<EFT.HandBook.Handbook>.Instance.GetBasePrice(item.TemplateId); }
            catch { return 0; }
        }

        // ── Loose Loot Capture ──
        private static bool _looseLootCaptured = false;
        public static void ResetLooseLootFlag() { _looseLootCaptured = false; }

        // ── Legacy Phobos Advection Field Capture (periodic — convergence field tracks players) ──
        // Opt-in only — gated by both PHOBOS_LEGACY__DETECTED and the user toggle.
        private static long _phobosFieldLastCapture = -999999;
        private const long PhobosFieldIntervalMs = 30000;
        public static void ResetPhobosFieldFlag() { _phobosFieldLastCapture = -999999; }

        private void CaptureLegacyPhobosField()
        {
            if (!PHOBOS_LEGACY__DETECTED) return;
            var now = stopwatch.ElapsedMilliseconds;
            if (now - _phobosFieldLastCapture < PhobosFieldIntervalMs) return;
            try
            {
                var field = Phobos_Integration.GetAdvectionFieldSnapshot(sessionId, now);
                if (field == null) return; // LocationSystem may not be ready yet — retry next tick
                _phobosFieldLastCapture = now;
                _ = Telemetry.Send("PHOBOS_FIELD", JsonConvert.SerializeObject(field));
            }
            catch (Exception ex)
            {
                _phobosFieldLastCapture = now;
                Logger.LogWarning($"RAID_REVIEW :::: WARN :::: Phobos field capture failed: {ex.Message}");
            }
        }

        // ── ORBIT Main Objectives Capture (periodic ~30s) ──
        // Per-squad list of main objectives + completion flags. Mostly static
        // (the list is frozen at squad creation) but Completed flags and
        // KillsRoamStartedAt mutate over the raid — periodic ticks let the
        // viz reflect progression.
        private static long _orbitMainObjLastCapture = -999999;
        private static int _orbitMainObjLastRevision = -1;
        private const long OrbitMainObjIntervalMs = 30000;
        public static void ResetOrbitMainObjFlag() { _orbitMainObjLastCapture = -999999; _orbitMainObjLastRevision = -1; }

        // ── ORBIT Ghost Fight Capture (drain per tick — cheap no-op when nothing happened) ──
        private void CaptureOrbitGhostFights()
        {
            if (!ORBIT__DETECTED) return;
            try
            {
                var fights = Orbit_Integration.GetGhostFights(sessionId, stopwatch.ElapsedMilliseconds);
                if (fights == null) return;
                foreach (var fight in fights)
                    _ = Telemetry.Send("ORBIT_GHOST_FIGHT", JsonConvert.SerializeObject(fight));
            }
            catch (Exception ex)
            {
                Logger.LogWarning($"RAID_REVIEW :::: WARN :::: ORBIT ghost-fight capture failed: {ex.Message}");
            }
        }

        private void CaptureOrbitMainObjectives()
        {
            if (!ORBIT__DETECTED) return;
            var now = stopwatch.ElapsedMilliseconds;
            // Re-snapshot on the periodic poll or immediately when the revision bumps (a main flipped Completed).
            var revision = Orbit_Integration.GetMainObjectivesRevision();
            if (now - _orbitMainObjLastCapture < OrbitMainObjIntervalMs && revision == _orbitMainObjLastRevision) return;
            try
            {
                var snapshot = Orbit_Integration.GetMainObjectivesSnapshot(sessionId, now);
                if (snapshot == null) return;
                _orbitMainObjLastCapture = now;
                _orbitMainObjLastRevision = revision;
                _ = Telemetry.Send("ORBIT_MAIN_OBJECTIVES", JsonConvert.SerializeObject(snapshot));
            }
            catch (Exception ex)
            {
                _orbitMainObjLastCapture = now;
                _orbitMainObjLastRevision = revision;
                Logger.LogWarning($"RAID_REVIEW :::: WARN :::: ORBIT main-objectives capture failed: {ex.Message}");
            }
        }

        // ── ORBIT Advection Field Capture (periodic ~30s) ──
        private static long _orbitFieldLastCapture = -999999;
        private const long OrbitFieldIntervalMs = 30000;
        public static void ResetOrbitFieldFlag() { _orbitFieldLastCapture = -999999; }

        private void CaptureOrbitField()
        {
            if (!ORBIT__DETECTED) return;
            var now = stopwatch.ElapsedMilliseconds;
            if (now - _orbitFieldLastCapture < OrbitFieldIntervalMs) return;
            try
            {
                var field = Orbit_Integration.GetAdvectionFieldSnapshot(sessionId, now);
                if (field == null) return;
                _orbitFieldLastCapture = now;
                _ = Telemetry.Send("ORBIT_FIELD", JsonConvert.SerializeObject(field));
            }
            catch (Exception ex)
            {
                // Stamp the throttle even on failure — a persistent error must warn once per interval,
                // not once per tick (issue ekky-llc#79: 2k+ identical warnings in an 8-minute raid).
                _orbitFieldLastCapture = now;
                Logger.LogWarning($"RAID_REVIEW :::: WARN :::: ORBIT field capture failed: {ex.Message}");
            }
        }

        private void CaptureLooseLoot()
        {
            if (_looseLootCaptured || gameWorld == null) return;
            _looseLootCaptured = true;

            try
            {
                var items = new List<TrackingLooseLootItem>();
                var seenIds = new HashSet<string>();

                foreach (var lootPoint in gameWorld.LootList)
                {
                    try
                    {
                        if (lootPoint is LootItem lootItem)
                        {
                            var item = lootItem.Item;
                            if (item == null) continue;
                            if (!seenIds.Add(item.Id)) continue;
                            var pos = lootItem.transform.position;
                            items.Add(new TrackingLooseLootItem
                            {
                                itemId = item.Id,
                                templateId = item.TemplateId.ToString(),
                                itemName = item.LocalizedShortName(),
                                price = GetHandbookPrice(item),
                                qty = item.StackObjectsCount,
                                x = pos.x, y = pos.y, z = pos.z,
                                inContainer = false,
                                containerName = ""
                            });
                        }
                        else if (lootPoint is LootableContainer container)
                        {
                            var rootItem = container.ItemOwner?.RootItem;
                            if (rootItem is CompoundItem compound)
                            {
                                var pos = container.transform.position;
                                var cName = "";
                                try { cName = rootItem.LocalizedShortName(); } catch { }
                                foreach (var grid in compound.Grids)
                                {
                                    foreach (var contained in grid.Items)
                                    {
                                        if (contained == null) continue;
                                        if (!seenIds.Add(contained.Id)) continue;
                                        items.Add(new TrackingLooseLootItem
                                        {
                                            itemId = contained.Id,
                                            templateId = contained.TemplateId.ToString(),
                                            itemName = contained.LocalizedShortName(),
                                            price = GetHandbookPrice(contained),
                                            qty = contained.StackObjectsCount,
                                            x = pos.x, y = pos.y, z = pos.z,
                                            inContainer = true,
                                            containerName = cName
                                        });
                                    }
                                }
                            }
                        }
                    }
                    catch { }
                }

                if (items.Count > 0)
                {
                    Logger.LogInfo($"RAID_REVIEW :::: INFO :::: Captured {items.Count} loose loot items");
                    var payload = new TrackingLooseLoot
                    {
                        sessionId = sessionId,
                        time = stopwatch.ElapsedMilliseconds,
                        items = items
                    };
                    _ = Telemetry.Send("LOOSE_LOOT", JsonConvert.SerializeObject(payload));
                }
            }
            catch (Exception ex)
            {
                Logger.LogWarning($"RAID_REVIEW :::: WARN :::: Loose loot capture failed: {ex.Message}");
            }
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

            EnableLegacyPhobos = Config.Bind<bool>("Legacy Integrations", "Enable legacy Phobos integration", true,
                "Captures bot-objective data from the legacy upstream Phobos mod (com.janky.phobos). NO SUPPORT — uses reflection (the mod doesn't expose a public API). Disable if you see errors.");
            EnableLegacyQuestingBots = Config.Bind<bool>("Legacy Integrations", "Enable legacy QuestingBots integration", true,
                "Only used with QuestingBots older than 0.11.0 (newer versions use the official interop API, always enabled). NO SUPPORT — uses reflection. Disable if you see errors.");

            // HTTP/Websocket Endpoint Builders
            RAID_REVIEW_WS_Server = (ServerTLS.Value ? "wss://" : "ws://") + ServerAddress.Value + (ServerWsPort.Value != "" ? ":" + ServerWsPort.Value : "");
            RAID_REVIEW_HTTP_Server = (ServerTLS.Value ? "https://" : "http://") + ServerAddress.Value + (ServerHttpPort.Value != "" ? ":" + ServerHttpPort.Value : "");
            Logger.LogInfo($"RAID_REVIEW :::: INFO :::: Configured WS Server: {RAID_REVIEW_WS_Server}");
            Logger.LogInfo($"RAID_REVIEW :::: INFO :::: Configured HTTP Server: {RAID_REVIEW_HTTP_Server}");

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

                    // IF MAP NOT LOADED — check if raid ended without OnGameSessionEnd (headless)
                    if (!MapLoaded())
                    {
                        if (inRaid)
                        {
                            try
                            {
                                tracking = false;
                                inRaid = false;
                                stopwatch.Stop();
                                trackingRaid.exitName = trackingRaid.exitName ?? "UNKNOWN";
                                trackingRaid.time = DateTime.Now;
                                trackingRaid.timeInRaid = stopwatch.ElapsedMilliseconds;

                                BotChecker.BotCheckLoop(true);
                                if (SOLARINT_SAIN__DETECTED) _ = SAIN_Integration.CheckForSainComponents(true);
                                Telemetry.Send("PLAYER_CHECK", JsonConvert.SerializeObject(trackingPlayers.Values));
                                Telemetry.Send("END", JsonConvert.SerializeObject(trackingRaid));
                            }
                            catch { }
                            finally
                            {
                                trackingPlayers = new Dictionary<string, TrackingPlayer>();
                                _lastBotQuestState.Clear();
                                _lastBotObjectiveState.Clear();
                                _seenLayerNames.Clear();
                                sessionId = null;
                                stopwatch.Reset();
                                if (ORBIT__DETECTED) Orbit_Integration.ResetSessionState();
                            }
                        }
                        continue;
                    }

                    gameWorld = Singleton<GameWorld>.Instance;
                    myPlayer = gameWorld?.MainPlayer; // null on Fika headless — that's OK

                    // IF IN MENU, RETURN (don't require myPlayer — headless has none)
                    if (gameWorld == null || gameWorld.LocationId == "hideout")
                    {
                        continue;
                    }

                    if (sessionId == null && gameWorld != null)
                    {
                        sessionId = gameWorld.CurrentProfileId?.ToString() ?? myPlayer?.ProfileId;
                    }

                    // IF RAID HAS NOT STARTED, RETURN
                    if (!inRaid)
                    {
                        continue;
                    }

                    // Capture loose loot once per raid (first tick after raid start)
                    CaptureLooseLoot();

                    // PLAYER TRACKING LOOP
                    IEnumerable<Player> allPlayers = gameWorld.AllPlayersEverExisted;
                    long captureTime = stopwatch.ElapsedMilliseconds;

                    // Refresh SAIN bot cache once per tick (before iterating players)
                    if (SOLARINT_SAIN__DETECTED)
                    {
                        InitSainReflection();
                        RefreshSainBotCache();
                    }
                    // Init QuestingBots reflection once
                    if (DANW_QUESTINGBOTS__DETECTED)
                    {
                        QuestingBots_Integration.InitReflection();
                    }
                    // Init legacy Phobos reflection once + refresh agent cache each tick
                    if (PHOBOS_LEGACY__DETECTED)
                    {
                        Phobos_Integration.InitReflection();
                        Phobos_Integration.RefreshAgentCache();
                        CaptureLegacyPhobosField();
                    }
                    if (ORBIT__DETECTED)
                    {
                        Orbit_Integration.InitReflection();
                        Orbit_Integration.RefreshAgentCache();
                        CaptureOrbitField();
                        CaptureOrbitMainObjectives();
                        CaptureOrbitGhostFights();
                    }
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
                                mod_SAIN_difficulty = "",
                                mod_SAIN_name = ""
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
                                    // UNTAR Go Home raider hunts: plain pmcBot spawned by MoreBotsAPI's
                                    // hunt system — label as UNTAR hunter instead of a vanilla Raider.
                                    if (role.ToString() == "pmcBot" && IsHuntSpawn(player))
                                        trackingPlayer.type = "UNTAR HUNTER|UNTAR";
                                    // Override cyrillic names for known bosses
                                    if (role.ToString() == "bossPartisan") trackingPlayer.name = "Partizan";
                                }
                                catch { }
                            }

                            trackingPlayers[trackingPlayer.profileId] = trackingPlayer;
                            _ = Telemetry.Send("PLAYER", JsonConvert.SerializeObject(trackingPlayer));

                            // Capture bot inventory at spawn
                            if (player.IsAI)
                            {
                                try
                                {
                                    var invItems = new List<TrackingInventoryItem>();
                                    foreach (var item in player.Inventory.GetPlayerItems(EPlayerItems.Equipment))
                                    {
                                        if (item == null) continue;
                                        invItems.Add(new TrackingInventoryItem
                                        {
                                            templateId = item.TemplateId.ToString(),
                                            itemName = item.LocalizedShortName(),
                                            price = GetHandbookPrice(item),
                                            qty = item.StackObjectsCount,
                                            slot = item.Parent?.Container?.ID ?? "unknown"
                                        });
                                    }
                                    if (invItems.Count > 0)
                                    {
                                        var invPayload = new TrackingPlayerInventory
                                        {
                                            sessionId = sessionId,
                                            profileId = player.ProfileId,
                                            time = stopwatch.ElapsedMilliseconds,
                                            items = invItems
                                        };
                                        _ = Telemetry.Send("PLAYER_INVENTORY", JsonConvert.SerializeObject(invPayload));
                                    }
                                }
                                catch { }
                            }

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
                                float currentHealthMaximum = commonHealth.Maximum;

                                // Bot behavior state
                                string decision = "";
                                if (player.IsAI)
                                {
                                    try
                                    {
                                        // Try SAIN reflection first for meaningful decision names
                                        var sainDec = GetSainDecision(player);
                                        if (!string.IsNullOrEmpty(sainDec))
                                        {
                                            decision = sainDec;
                                        }
                                        else
                                        {
                                            // Vanilla fallback — always send, even BigBrain IDs (frontend maps 9000+)
                                            var botOwner = player.AIData?.BotOwner;
                                            if (botOwner?.Brain != null)
                                            {
                                                var lastDecision = botOwner.Brain.LastDecision;
                                                if (lastDecision.HasValue)
                                                    decision = lastDecision.Value.ToString();
                                            }
                                        }
                                    }
                                    catch { }
                                }

                                // Override idle/patrol decisions with BigBrain layer name (LootingBots, etc.)
                                if (player.IsAI && IsIdleOrPatrolDecision(decision))
                                {
                                    try
                                    {
                                        var botOwner = player.AIData?.BotOwner;
                                        var layerName = botOwner?.Brain != null ? botOwner.Brain.ActiveLayerName() : null;
                                        if (!string.IsNullOrEmpty(layerName))
                                        {
                                            // Log unique layer names for debugging
                                            if (_seenLayerNames.Add(layerName))
                                                Logger.LogInfo($"RAID_REVIEW :::: BRAIN_LAYER :::: {layerName}");

                                            // BigBrain layer names from various mods. "LootPatrol" is a
                                            // vanilla BSG layer — only credit LootingBots for other
                                            // Loot* layers, and only when the mod is actually loaded.
                                            if (layerName == "LootPatrol")
                                                decision = layerName;
                                            else if (layerName.Contains("Loot") && RAID_REVIEW__DETECTED_MODS.Contains("LOOTING_BOTS"))
                                                decision = "LootingBots:" + layerName;
                                            else if (layerName.Contains("Follower") || layerName.Contains("Regroup"))
                                                decision = "BL:" + layerName;
                                        }
                                    }
                                    catch { }
                                }

                                // Override idle/patrol decisions with active quest info from QuestingBots
                                if (DANW_QUESTINGBOTS__DETECTED && player.IsAI)
                                {
                                    try
                                    {
                                        var qd = QuestingBots_Integration.GetBotQuestData(player, sessionId, captureTime);
                                        if (qd != null && (qd.status == "Active" || qd.status == "Pending"))
                                        {
                                            var isIdleOrPatrol = IsIdleOrPatrolDecision(decision);
                                            if (isIdleOrPatrol)
                                                decision = "QB:" + qd.questName;
                                        }
                                    }
                                    catch { }
                                }

                                // Override idle/patrol decisions with ORBIT objective info.
                                // Legacy Phobos uses an independent integration class — when
                                // both happen to be (mis-)installed ORBIT wins since it
                                // carries the richer state surface.
                                if (ORBIT__DETECTED && player.IsAI)
                                {
                                    try
                                    {
                                        var od = Orbit_Integration.GetBotObjectiveData(player, sessionId, captureTime);
                                        if (od != null && IsIdleOrPatrolDecision(decision))
                                        {
                                            // Finished means the bot reached the objective and is guarding it.
                                            if (od.status == "Moving" || od.status == "Looting")
                                                decision = "Orbit:" + od.category;
                                            else if (od.status == "Finished")
                                                decision = "Orbit:Guarding";
                                        }
                                    }
                                    catch { }
                                }
                                else if (PHOBOS_LEGACY__DETECTED && player.IsAI)
                                {
                                    try
                                    {
                                        var od = Phobos_Integration.GetBotObjectiveData(player, sessionId, captureTime);
                                        if (od != null && od.status == "Moving")
                                        {
                                            var isIdleOrPatrol = IsIdleOrPatrolDecision(decision);
                                            if (isIdleOrPatrol)
                                                decision = "Phobos:" + od.category;
                                        }
                                    }
                                    catch { }
                                }

                                // ORBIT AI limiter: flag ghost (dormant) bots on every sample so the
                                // replay can fade their dot. Guarded like every other ORBIT call (JIT safety).
                                var ghost = false;
                                if (ORBIT__DETECTED && player.IsAI)
                                {
                                    try { ghost = Orbit_Integration.IsBotGhost(player); }
                                    catch { }
                                }

                                var trackingPlayerData = new TrackingPlayerData(sessionId, player.ProfileId, captureTime, playerPosition.x, playerPosition.y, playerPosition.z, dir, currentHealth, currentHealthMaximum, decision, ghost);
                                _ = Telemetry.Send("POSITION", JsonConvert.SerializeObject(trackingPlayerData));
                            }

                            // QuestingBots: send quest data when it changes
                            if (DANW_QUESTINGBOTS__DETECTED && player.IsAI)
                            {
                                try
                                {
                                    var questData = QuestingBots_Integration.GetBotQuestData(player, sessionId, captureTime);
                                    if (questData != null)
                                    {
                                        var stateKey = $"{questData.questName}|{questData.status}|{questData.actionType}";
                                        _lastBotQuestState.TryGetValue(player.ProfileId, out var lastState);
                                        if (stateKey != lastState)
                                        {
                                            _lastBotQuestState[player.ProfileId] = stateKey;
                                            _ = Telemetry.Send("BOT_QUEST", JsonConvert.SerializeObject(questData));
                                        }
                                    }
                                }
                                catch { }
                            }

                            // Per-bot objective telemetry. Two independent codepaths:
                            // ORBIT emits ORBIT_BOT_OBJECTIVE, legacy Phobos emits
                            // BOT_OBJECTIVE (kept for legacy compatibility — gated).
                            if (ORBIT__DETECTED && player.IsAI)
                            {
                                try
                                {
                                    var objData = Orbit_Integration.GetBotObjectiveData(player, sessionId, captureTime);
                                    if (objData != null)
                                    {
                                        var stateKey = $"{objData.status}|{objData.category}|{objData.objectiveX:F1}|{objData.objectiveZ:F1}";
                                        _lastBotObjectiveState.TryGetValue(player.ProfileId, out var lastState);
                                        if (stateKey != lastState)
                                        {
                                            _lastBotObjectiveState[player.ProfileId] = stateKey;
                                            _ = Telemetry.Send("ORBIT_BOT_OBJECTIVE", JsonConvert.SerializeObject(objData));
                                        }
                                    }
                                }
                                catch { }
                            }
                            else if (PHOBOS_LEGACY__DETECTED && player.IsAI)
                            {
                                try
                                {
                                    var objData = Phobos_Integration.GetBotObjectiveData(player, sessionId, captureTime);
                                    if (objData != null)
                                    {
                                        var stateKey = $"{objData.status}|{objData.category}|{objData.objectiveX:F1}|{objData.objectiveZ:F1}";
                                        _lastBotObjectiveState.TryGetValue(player.ProfileId, out var lastState);
                                        if (stateKey != lastState)
                                        {
                                            _lastBotObjectiveState[player.ProfileId] = stateKey;
                                            _ = Telemetry.Send("BOT_OBJECTIVE", JsonConvert.SerializeObject(objData));
                                        }
                                    }
                                }
                                catch { }
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
        // ISB SOF ships several plugins (ISBSpecialForces / ISBNotify / ISBSOF_Extras)
        // whose GUIDs vary by version and com.-prefix, so match any loaded plugin whose
        // GUID contains the substring instead of relying on one exact id.
        public static bool DetectModContaining(string substring)
        {
            foreach (var key in Chainloader.PluginInfos.Keys)
                if (key.IndexOf(substring, System.StringComparison.OrdinalIgnoreCase) >= 0) return true;
            return false;
        }
        public static bool MapLoaded() => Singleton<GameWorld>.Instantiated;

    }
}