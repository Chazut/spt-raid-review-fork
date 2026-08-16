using EFT;
using BepInEx;
using UnityEngine;
using Comfort.Common;
using System.Collections.Generic;
using System;
using EFT.HealthSystem;

namespace RAID_REVIEW
{

    public class TrackingRaid
    {
        public string sessionId { get; set; }
        public string profileId { get; set; }
        public string location { get; set; }
        public string detectedMods { get; set; }
        public DateTime time { get; set; }
        public long timeInRaid { get; set; }
        public string exitName { get; set; }
        public string type { get; set; }
        public ExitStatus exitStatus { get; set; }
    }

    public class TrackingPlayer
    { 
        public string sessionId { get; set; }
        public string profileId { get; set; }
        public int level { get; set; }
        public EPlayerSide team { get; set; }
        public string name { get; set; }
        public string type { get; set; }
        public int group {  get; set; }
        public long spawnTime { get; set; }
        public string mod_SAIN_brain { get; set; }
        public string mod_SAIN_difficulty { get; set; }
        public string mod_SAIN_name { get; set; }
    }

    public class TrackingRaidKill
    {
        public long time { get; set; }
        public string sessionId { get; set; }
        public string profileId { get; set; }
        public string killedId { get; set; }
        public string weapon {  get; set; }
        // Weapon template id so the server can resolve the display name when the
        // client can't (Fika headless: LocalizedShortName returns empty).
        public string weaponTemplateId { get; set; }
        public float distance { get; set; }
        public string bodyPart {  get; set; }
        public string type { get; set; }
        public string positionKiller { get; set; }
        public string positionKilled { get; set; }
    }

    public class TrackingLootItem
    {
        public string sessionId { get; set; }
        public string profileId { get; set; }
        public long time { get; set; }
        public string itemId { get; set; }
        public string templateId { get; set; }
        public string itemName { get; set; }
        public int price { get; set; }
        public int qty { get; set; }
        public string type { get; set; }
        public bool added {  get; set; }
        public float x { get; set; }
        public float y { get; set; }
        public float z { get; set; }
    }

    public class TrackingPlayerData
    {
        public string sessionId { get; set; }
        public string profileId { get; set; }
        public long time { get; set; }
        public float x { get; set; }
        public float y { get; set; }
        public float z { get; set; }
        public float dir { get; set; }
        public float health { get; set; }
        public float maxHealth { get; set; }
        public string decision { get; set; }

        public TrackingPlayerData(
            string sessionId,
            string profileId,
            long time,
            float x,
            float y,
            float z,
            float dir,
            float health,
            float maxHealth,
            string decision = ""
        )
        {
            this.sessionId = sessionId;
            this.profileId = profileId;
            this.time = time;
            this.x = x;
            this.y = y;
            this.z = z;
            this.dir = dir;
            this.health = health;
            this.maxHealth = maxHealth;
            this.decision = decision;
        }
    }

    public class TrackingPlayerDeadOrUnspawned 
    {
        public string sessionId { get; set; }
        public string profileId { get; set; }
        public long time { get; set; }
        public PlayerStatus status { get; set; }
    }

    public enum PlayerStatus {
        Alive,
        Dead,
        Unspawned,
        Unknown
    }

    public class TrackingBallistic {
        public string sessionId { get; set; }
        public string profileId { get; set; }
        public long time { get; set; }
        public string weaponId { get; set; }
        public string weaponName { get; set; }
        public string ammoId { get; set; }
        public string hitPlayerId { get; set; }
        public string source { get; set; }
        public string target { get; set; }
    }

    public class TrackingLooseLoot
    {
        public string sessionId { get; set; }
        public long time { get; set; }
        public List<TrackingLooseLootItem> items { get; set; }
    }

    public class TrackingLooseLootItem
    {
        public string itemId { get; set; }
        public string templateId { get; set; }
        public string itemName { get; set; }
        public int price { get; set; }
        public int qty { get; set; }
        public float x { get; set; }
        public float y { get; set; }
        public float z { get; set; }
        public bool inContainer { get; set; }
        public string containerName { get; set; }
    }

    public class TrackingPlayerInventory
    {
        public string sessionId { get; set; }
        public string profileId { get; set; }
        public long time { get; set; }
        public List<TrackingInventoryItem> items { get; set; }
    }

    public class TrackingInventoryItem
    {
        public string templateId { get; set; }
        public string itemName { get; set; }
        public int price { get; set; }
        public int qty { get; set; }
        public string slot { get; set; }
    }

    public class TrackingBotQuest
    {
        public string sessionId { get; set; }
        public string profileId { get; set; }
        public long time { get; set; }
        public string questName { get; set; }
        public bool isEFTQuest { get; set; }
        public string actionType { get; set; }
        public string status { get; set; }
        public float objectiveX { get; set; }
        public float objectiveY { get; set; }
        public float objectiveZ { get; set; }
    }

    public class TrackingBotObjective
    {
        public string sessionId { get; set; }
        public string profileId { get; set; }
        public long time { get; set; }
        public string status { get; set; }
        public string category { get; set; }
        public bool isLeader { get; set; }
        public float objectiveX { get; set; }
        public float objectiveY { get; set; }
        public float objectiveZ { get; set; }
    }

    public class TrackingPhobosField
    {
        public string sessionId { get; set; }
        public long time { get; set; }
        public int gridCols { get; set; }
        public int gridRows { get; set; }
        public float worldMinX { get; set; }
        public float worldMinZ { get; set; }
        public float cellSize { get; set; }
        public List<TrackingPhobosCell> advection { get; set; }
        public List<TrackingPhobosCell> convergence { get; set; }
        public List<TrackingPhobosZone> zones { get; set; }
    }

    public class TrackingPhobosCell
    {
        public int x { get; set; }
        public int y { get; set; }
        public float fx { get; set; }
        public float fz { get; set; }
    }

    public class TrackingPhobosZone
    {
        public int x { get; set; }
        public int y { get; set; }
        public float radius { get; set; }
        public float force { get; set; }
        public float decay { get; set; }
    }

    // ────────────────────────────────────────────────────────────────────
    // ORBIT tracking models. Kept fully independent from the legacy
    // TrackingPhobos* types above — different mod, different telemetry
    // packets, different DB tables.
    // ────────────────────────────────────────────────────────────────────

    public class TrackingOrbitBotObjective
    {
        public string sessionId { get; set; }
        public string profileId { get; set; }
        public long time { get; set; }
        public string status { get; set; }
        public string category { get; set; }
        public bool isLeader { get; set; }
        public float objectiveX { get; set; }
        public float objectiveY { get; set; }
        public float objectiveZ { get; set; }
        // Non-empty when the squad has flipped ExtractRequested. Mirrors
        // Squad.ExtractRequestedReason — a short human-readable label like
        // 'loot ≥ 500k₽' / 'all mains done' / 'raid time low'. Used by the
        // bot tooltip when the objective is Extract.
        public string extractReason { get; set; }
    }

    public class TrackingOrbitField
    {
        public string sessionId { get; set; }
        public long time { get; set; }
        public int gridCols { get; set; }
        public int gridRows { get; set; }
        public float worldMinX { get; set; }
        public float worldMinZ { get; set; }
        public float cellSize { get; set; }
        public List<TrackingOrbitCell> advection { get; set; }
        public List<TrackingOrbitZone> zones { get; set; }
    }

    public class TrackingOrbitCell
    {
        public int x { get; set; }
        public int y { get; set; }
        public float fx { get; set; }
        public float fz { get; set; }
    }

    public class TrackingOrbitZone
    {
        public int x { get; set; }
        public int y { get; set; }
        public float radius { get; set; }
        public float force { get; set; }
        public float decay { get; set; }
    }

    /// <summary>
    /// Periodic snapshot of every squad's main-objective list. Drives the
    /// raid-review "click a bot → show this squad's main objectives"
    /// overlay. Empty squads (bot scavs / bosses / raiders / goons that
    /// skip the main-objectives system) aren't included.
    /// </summary>
    public class TrackingOrbitMainObjectives
    {
        public string sessionId { get; set; }
        public long time { get; set; }
        public List<TrackingOrbitSquadMainObjectives> squads { get; set; }
    }

    public class TrackingOrbitSquadMainObjectives
    {
        public int squadId { get; set; }
        // ProfileIds of every member — frontend matches a clicked bot's
        // ProfileId against these lists to find their squad.
        public List<string> memberProfileIds { get; set; }
        public List<TrackingOrbitMainObjective> mainObjectives { get; set; }
    }

    public class TrackingOrbitMainObjective
    {
        public string type { get; set; } // "Kills" | "LootValue" | "Quest"
        public int cellX { get; set; }
        public int cellY { get; set; }
        public float x { get; set; }
        public float y { get; set; }
        public float z { get; set; }
        public bool completed { get; set; }
        // Kills-type extras (0/0 for non-Kills). killsRoamStartedAt > 0
        // means the squad entered roam phase ("started" for the viz).
        public float killsRoamStartedAt { get; set; }
        public float killsRoamTargetDuration { get; set; }
        // LootValue-type extras (0 for non-LootValue). lootValueEnteredAt > 0
        // means a member has entered the anchor cell. lootValueTotal is the
        // precomputed sum of handbook prices for every item in every
        // Container + LooseLoot waypoint of the cell, captured at squad
        // creation — static throughout the raid.
        public float lootValueEnteredAt { get; set; }
        public float lootValueTotal { get; set; }
        // True when the squad has entered the cell but is currently paused
        // (combat broke out OR no member is in the cell right now). Goes
        // back to false when engagement resumes. Drives the raid-review
        // "interrupted" visual on the main marker.
        public bool lootValueInterrupted { get; set; }
        // Quest-type extras (null for non-Quest)
        public string questTriggerId { get; set; }
        public string questTitle { get; set; }
    }
}