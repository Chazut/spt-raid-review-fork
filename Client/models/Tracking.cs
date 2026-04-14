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
    }

    public class TrackingRaidKill
    {
        public long time { get; set; }
        public string sessionId { get; set; }
        public string profileId { get; set; }
        public string killedId { get; set; }
        public string weapon {  get; set; }
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
}