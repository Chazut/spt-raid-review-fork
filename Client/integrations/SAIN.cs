using Aki.Reflection.Patching;
using Comfort.Common;
using EFT;
using EFT.Communications;
using Newtonsoft.Json;
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Reflection;
using System.Threading.Tasks;

namespace RAID_REVIEW
{
    class SAIN_Integration
    {
        public static async Task CheckForSainComponents(bool delay = true)
        {
            try
            {

                Type sainBotControllerType = Type.GetType("SAIN.Components.SAINBotController, SAIN");
                Type botComponentType = Type.GetType("SAIN.Components.BotComponent, SAIN");
                Type ePersonalityType = Type.GetType("SAIN.EPersonality, SAIN");

                if (sainBotControllerType == null)
                {
                    LoggerInstance.Log.LogError("RAID_REVIEW :::: INFO :::: SAINBotController type not found.");
                    return;
                }

                if (ePersonalityType == null)
                {
                    LoggerInstance.Log.LogError("RAID_REVIEW :::: INFO :::: EPersonality type not found.");
                    return;
                }

                while (RAID_REVIEW.searchingForSainComponents)
                {
                    if (delay)
                    {
                        await Task.Delay(5000);
                    }

                    if (RAID_REVIEW.sainBotController == null)
                    {
                        LoggerInstance.Log.LogInfo("RAID_REVIEW :::: INFO :::: Looking For SAIN Bot Controller");
                        if (RAID_REVIEW.gameWorld != null)
                        {
                            // Use reflection to get the SAINBotController component
                            MethodInfo getComponentMethod = RAID_REVIEW.gameWorld.GetType().GetMethod("GetComponent", new Type[] { typeof(Type) });
                            RAID_REVIEW.sainBotController = getComponentMethod?.Invoke(RAID_REVIEW.gameWorld, new object[] { sainBotControllerType });

                            if (RAID_REVIEW.sainBotController != null)
                                LoggerInstance.Log.LogInfo("RAID_REVIEW :::: INFO :::: SAIN Bot Controller Found");
                            else
                                LoggerInstance.Log.LogInfo("RAID_REVIEW :::: INFO :::: SAIN Bot Controller Not Found");
                        }
                        else
                        {
                            LoggerInstance.Log.LogInfo("RAID_REVIEW :::: INFO :::: GameWorld Not Found");
                        }
                    }
                    else
                    {
                        // Get the Bots property using reflection
                        PropertyInfo botsProperty = sainBotControllerType.GetProperty("Bots");
                        var bots = botsProperty?.GetValue(RAID_REVIEW.sainBotController);

                        // Get the Values property of the Bots dictionary
                        var botValues = (IEnumerable)bots?.GetType().GetProperty("Values").GetValue(bots);

                        foreach (var botComponent in botValues)
                        {
                            var playerProperty = botComponent.GetType().GetProperty("Player");
                            var player = playerProperty?.GetValue(botComponent);
                            var profileId = player?.GetType().GetProperty("ProfileId")?.GetValue(player) as string;

                            if (!RAID_REVIEW.updatedBots.ContainsKey(profileId) && RAID_REVIEW.trackingPlayers.ContainsKey(profileId))
                            {
                                var trackingPlayer = RAID_REVIEW.trackingPlayers[profileId];
                                var infoProperty = botComponent.GetType().GetProperty("Info");
                                var info = infoProperty?.GetValue(botComponent);

                                var personality = info?.GetType().GetProperty("Personality")?.GetValue(info);

                                if (personality != null && Enum.IsDefined(ePersonalityType, personality))
                                {
                                    trackingPlayer.mod_SAIN_brain = Enum.GetName(ePersonalityType, personality);
                                }
                                else
                                {
                                    trackingPlayer.mod_SAIN_brain = "UNKNOWN";
                                }

                                trackingPlayer.mod_SAIN_difficulty = info?.GetType().GetProperty("BotDifficulty")?.GetValue(info)?.ToString();

                                var profileProperty = info?.GetType().GetProperty("Profile");
                                var isPMC = (bool?)profileProperty?.GetType().GetProperty("IsPMC")?.GetValue(profileProperty) ?? false;

                                if (!isPMC)
                                {
                                    trackingPlayer.type = getBotType(botComponent);
                                }

                                RAID_REVIEW.trackingPlayers[trackingPlayer.profileId] = trackingPlayer;
                                RAID_REVIEW.updatedBots[trackingPlayer.profileId] = trackingPlayer;
                                LoggerInstance.Log.LogInfo($"RAID_REVIEW :::: INFO :::: Updating player {trackingPlayer.name} with brain {trackingPlayer.mod_SAIN_brain}, type {trackingPlayer.type}, difficulty {trackingPlayer.mod_SAIN_difficulty}");
                                _ = Telemetry.Send("PLAYER_UPDATE", JsonConvert.SerializeObject(trackingPlayer));
                            }
                        }
                    }

                }
                return;

            }
            catch (Exception e)
            {
                LoggerInstance.Log.LogFatal($"RAID_REVIEW :::: ERROR :::: {e}");
            }
        }

        public static string getBotType(object botComponent)
        {
            string RR_WildSpawnType = "UNKNOWN";
            if (RAID_REVIEW.SOLARINT_SAIN__DETECTED)
            {
                // Get the BotComponent type
                Type botComponentType = Type.GetType("SAIN.SAINComponent.BotComponent, SAIN");

                // Ensure botComponent is of the correct type
                if (botComponent == null || !botComponentType.IsInstanceOfType(botComponent))
                {
                    LoggerInstance.Log?.LogError("Invalid BotComponent instance.");
                    return RR_WildSpawnType;
                }

                // Access the Info property
                PropertyInfo infoProperty = botComponentType.GetProperty("Info");
                var info = infoProperty?.GetValue(botComponent);

                if (info == null)
                {
                    LoggerInstance.Log?.LogError("Info property is null.");
                    return RR_WildSpawnType;
                }

                // Access the Profile property from Info
                PropertyInfo profileProperty = info.GetType().GetProperty("Profile");
                var profile = profileProperty?.GetValue(info);

                if (profile == null)
                {
                    LoggerInstance.Log?.LogError("Profile property is null.");
                    return RR_WildSpawnType;
                }

                // Access WildSpawnType and IsBoss properties from Profile
                PropertyInfo wildSpawnTypeProperty = profile.GetType().GetProperty("WildSpawnType");
                var wildSpawnType = wildSpawnTypeProperty?.GetValue(profile);

                PropertyInfo isBossProperty = profile.GetType().GetProperty("IsBoss");
                bool isBoss = (bool)(isBossProperty?.GetValue(profile) ?? false);

                PropertyInfo isPlayerScavProperty = profile.GetType().GetProperty("IsPlayerScav");
                bool isPlayerScav = (bool)(isPlayerScavProperty?.GetValue(profile) ?? false);

                // Handle the wild spawn type
                if (wildSpawnType != null)
                {
                    switch (wildSpawnType.ToString())
                    {
                        case "assault":
                            RR_WildSpawnType = "SCAV|SCAV";
                            break;
                        case "assaultGroup":
                            RR_WildSpawnType = "SCAV GROUP|SCAV";
                            break;
                        case "crazyAssaultEvent":
                            RR_WildSpawnType = "CRAZY SCAV EVENT|SCAV";
                            break;
                        case "marksman":
                            RR_WildSpawnType = "SCAV SNIPER|SNIPER";
                            break;
                        case "cursedAssault":
                            RR_WildSpawnType = "TAGGED AND CURSED SCAV|SCAV";
                            break;
                        case "bossKnight":
                            RR_WildSpawnType = "KNIGHT|GOON";
                            break;
                        case "followerBigPipe":
                            RR_WildSpawnType = "BIGPIPE|GOON";
                            break;
                        case "followerBirdEye":
                            RR_WildSpawnType = "BIRDEYE|GOON";
                            break;
                        case "exUsec":
                            RR_WildSpawnType = "ROGUE|FOLLOWER";
                            break;
                        case "pmcBot":
                            RR_WildSpawnType = "RAIDER|FOLLOWER";
                            break;
                        case "arenaFighterEvent":
                            RR_WildSpawnType = "BLOODHOUND|BLOODHOUND";
                            break;
                        case "sectantPriest":
                            RR_WildSpawnType = "CULTIST PRIEST|CULT";
                            break;
                        case "sectantWarrior":
                            RR_WildSpawnType = "CULTIST|CULT";
                            break;
                        case "bossKilla":
                            RR_WildSpawnType = "KILLA|BOSS";
                            break;
                        case "bossBully":
                            RR_WildSpawnType = "RASHALA|BOSS";
                            break;
                        case "followerBully":
                            RR_WildSpawnType = "RASHALA GUARD|FOLLOWER";
                            break;
                        case "bossKojaniy":
                            RR_WildSpawnType = "SHTURMAN|BOSS";
                            break;
                        case "followerKojaniy":
                            RR_WildSpawnType = "SHTURMAN GUARD|FOLLOWER";
                            break;
                        case "bossTagilla":
                            RR_WildSpawnType = "TAGILLA|BOSS";
                            break;
                        case "followerTagilla":
                            RR_WildSpawnType = "TAGILLA GUARD|FOLLOWER";
                            break;
                        case "bossSanitar":
                            RR_WildSpawnType = "SANITAR|BOSS";
                            break;
                        case "followerSanitar":
                            RR_WildSpawnType = "SANITAR GUARD|FOLLOWER";
                            break;
                        case "bossGluhar":
                            RR_WildSpawnType = "GLUHAR|BOSS";
                            break;
                        case "followerGluharSnipe":
                            RR_WildSpawnType = "GLUHAR GUARD SNIPE|FOLLOWER";
                            break;
                        case "followerGluharScout":
                            RR_WildSpawnType = "GLUHAR GUARD SCOUT|FOLLOWER";
                            break;
                        case "followerGluharSecurity":
                            RR_WildSpawnType = "GLUHAR GUARD SECURITY|FOLLOWER";
                            break;
                        case "followerGluharAssault":
                            RR_WildSpawnType = "GLUHAR GUARD ASSAULT|FOLLOWER";
                            break;
                        case "bossZryachiy":
                            RR_WildSpawnType = "ZRYACHIY|BOSS";
                            break;
                        case "followerZryachiy":
                            RR_WildSpawnType = "ZRYACHIY GUARD|FOLLOWER";
                            break;
                        case "bossBoar":
                            RR_WildSpawnType = "KABAN|BOSS";
                            break;
                        case "followerBoar":
                            RR_WildSpawnType = "KABAN GUARD|FOLLOWER";
                            break;
                        case "bossBoarSniper":
                            RR_WildSpawnType = "KABAN SNIPER|FOLLOWER";
                            break;
                        case "bossKolontay":
                            RR_WildSpawnType = "KOLONTAY|BOSS";
                            break;
                        case "followerKolontayAssault":
                            RR_WildSpawnType = "KOLONTAY ASSAULT|FOLLOWER";
                            break;
                        case "followerKolontaySecurity":
                            RR_WildSpawnType = "KOLONTAY SECURITY|FOLLOWER";
                            break;
                        case "shooterBTR":
                            RR_WildSpawnType = "BTR|OTHER";
                            break;
                        default:
                            RR_WildSpawnType = "UNKNOWN";
                            break;
                    }
                }

                // If verison 2.3.3 or later, use the `isPlayerSav` method.
                if (isPlayerScav)
                {
                    RR_WildSpawnType = "PLAYER_SCAV|SCAV";
                }

                // If a boss hasn't already been found, but the 'IsBoss' flag is true, return a 'boss'
                if (!RR_WildSpawnType.EndsWith("BOSS") && isBoss)
                {
                    RR_WildSpawnType = "CUSTOM|BOSS";
                }
            }

            return RR_WildSpawnType;
        }


    }

}