using SPT.Reflection.Patching;
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
        public static async Task CheckForSainComponents(bool endCheck = false)
        {
            if(!RAID_REVIEW.SOLARINT_SAIN__DETECTED) return;
            try
            {

                Type sainBotControllerType = Type.GetType("SAIN.Components.BotManagerComponent, SAIN");
                Type botComponentType = Type.GetType("SAIN.Components.BotComponent, SAIN");
                Type ePersonalityType = Type.GetType("SAIN.Models.Preset.Personalities.EPersonality, SAIN");

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
                    if (!endCheck) await Task.Delay(5000); 
                    else RAID_REVIEW.searchingForSainComponents = false;

                    if (RAID_REVIEW.sainBotController == null)
                    {
                        LoggerInstance.Log.LogInfo("RAID_REVIEW :::: INFO :::: Looking For SAIN Bot Controller");
                        if (RAID_REVIEW.gameWorld != null)
                        {
                            // Use reflection to get the BotManagerComponent
                            MethodInfo getComponentMethod = RAID_REVIEW.gameWorld.GetType().GetMethod("GetComponent", new Type[] { typeof(Type) });
                            RAID_REVIEW.sainBotController = getComponentMethod?.Invoke(RAID_REVIEW.gameWorld, new object[] { sainBotControllerType });

                            // Fallback: try static Instance property
                            if (RAID_REVIEW.sainBotController == null)
                            {
                                var instanceProp = sainBotControllerType.GetProperty("Instance", BindingFlags.Public | BindingFlags.Static);
                                RAID_REVIEW.sainBotController = instanceProp?.GetValue(null);
                            }

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
                                var profileProperty = info?.GetType().GetProperty("Profile");
                                var profile = profileProperty?.GetValue(info);

                                var personality = info?.GetType().GetProperty("Personality")?.GetValue(info);

                                if (personality != null && Enum.IsDefined(ePersonalityType, personality))
                                {
                                    trackingPlayer.mod_SAIN_brain = Enum.GetName(ePersonalityType, personality);
                                }
                                else
                                {
                                    trackingPlayer.mod_SAIN_brain = "UNKNOWN";
                                }

                                var botDifficulty = info?.GetType().GetProperty("BotDifficulty")?.GetValue(info);
                                if (botDifficulty == null)
                                {
                                    botDifficulty = profile?.GetType().GetProperty("BotDifficulty")?.GetValue(profile);
                                }
                                if (botDifficulty == null)
                                {
                                    botDifficulty = profile?.GetType().GetField("BotDifficulty")?.GetValue(profile);
                                }
                                trackingPlayer.mod_SAIN_difficulty = botDifficulty?.ToString() ?? "";

                                var isPmcValue = profile?.GetType().GetProperty("IsPMC")?.GetValue(profile);
                                if (isPmcValue == null)
                                {
                                    isPmcValue = profile?.GetType().GetField("IsPMC")?.GetValue(profile);
                                }
                                var isPMC = (bool)isPmcValue;

                                if (!isPMC)
                                {
                                    var sainType = getBotType(info, profile);
                                    // Only update if current type is generic or SAIN provides a specific (non-scav) type.
                                    // Custom faction mods register bots that SAIN sees as "assault" internally,
                                    // but mod.cs already identified them correctly via player.Profile.Info.Settings.Role.
                                    bool currentIsGeneric = trackingPlayer.type == "BOT" || trackingPlayer.type == "UNKNOWN" || trackingPlayer.type == "SCAV|SCAV";
                                    bool sainIsGeneric = sainType == "SCAV|SCAV" || sainType == "SCAV GROUP|SCAV" || sainType == "CRAZY SCAV EVENT|SCAV" || sainType == "TAGGED AND CURSED SCAV|SCAV";
                                    if (currentIsGeneric || !sainIsGeneric)
                                    {
                                        trackingPlayer.type = sainType;
                                    }

                                    // ISB faction only: capture SAIN's bot-type display name
                                    // (e.g. "ISB Operator") from SAIN's static registry, keyed by
                                    // WildSpawnType. This is the name the faction author controls,
                                    // so it isn't tied to the (often misleading) WildSpawnType role.
                                    if (sainType.EndsWith("|ISB"))
                                    {
                                        trackingPlayer.mod_SAIN_name = getSainBotTypeName(profile);
                                    }
                                }

                                RAID_REVIEW.trackingPlayers[trackingPlayer.profileId] = trackingPlayer;
                                RAID_REVIEW.updatedBots[trackingPlayer.profileId] = trackingPlayer;
                                LoggerInstance.Log.LogInfo($"RAID_REVIEW :::: INFO :::: Updating player {trackingPlayer.name} with brain {trackingPlayer.mod_SAIN_brain}, type {trackingPlayer.type}, difficulty {trackingPlayer.mod_SAIN_difficulty}, sainName {trackingPlayer.mod_SAIN_name}");
                                _ = Telemetry.Send("PLAYER_UPDATE", JsonConvert.SerializeObject(trackingPlayer));
                            }
                        }
                    }
                }

                RAID_REVIEW.searchingForSainComponents = false;
                RAID_REVIEW.updatedBots.Clear();
                RAID_REVIEW.sainBotController = null;
                return;

            }
            catch (Exception e)
            {
                LoggerInstance.Log.LogFatal($"RAID_REVIEW :::: ERROR :::: {e}");
            }
        }

        public static string getBotType(object info, object profile)
        {
            string RR_WildSpawnType = "UNKNOWN";
            if (RAID_REVIEW.SOLARINT_SAIN__DETECTED)
            {
                if (info == null)
                {
                    LoggerInstance.Log?.LogError("Info is null.");
                    return RR_WildSpawnType;
                }
                if (profile == null)
                {
                    LoggerInstance.Log?.LogError("Profile is null.");
                    return RR_WildSpawnType;
                }

                // Access WildSpawnType, IsBoss and IsPlayerScav properties
                var wildSpawnType = profile.GetType().GetProperty("WildSpawnType")?.GetValue(profile);
                if (wildSpawnType == null)
                {
                    wildSpawnType = profile.GetType().GetField("WildSpawnType")?.GetValue(profile);
                }

                var isBossValue = profile.GetType().GetProperty("IsBoss")?.GetValue(profile);
                if (isBossValue == null)
                {
                    isBossValue = profile.GetType().GetField("IsBoss")?.GetValue(profile);
                }
                bool isBoss = (bool)isBossValue;

                var isPlayerScavValue = profile.GetType().GetProperty("IsPlayerScav")?.GetValue(profile);
                if (isPlayerScavValue == null)
                {
                    isPlayerScavValue = profile.GetType().GetField("IsPlayerScav")?.GetValue(profile);
                }
                bool isPlayerScav = (bool)isPlayerScavValue;

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
                        case "bossPartisan":
                            RR_WildSpawnType = "PARTIZAN|BOSS";
                            break;
                        case "shooterBTR":
                            RR_WildSpawnType = "BTR|OTHER";
                            break;

                        // LABYRINTH
                        case "bossTagillaAgro":
                            RR_WildSpawnType = "SHADOW TAGILLA|BOSS";
                            break;
                        case "bossKillaAgro":
                            RR_WildSpawnType = "VENGEFUL KILLA|BOSS";
                            break;
                        case "tagillaHelperAgro":
                            RR_WildSpawnType = "SHADOW TAGILLA GUARD|FOLLOWER";
                            break;
                        case "infectedAssault":
                            RR_WildSpawnType = "INFECTED|INFECTED";
                            break;
                        case "infectedPmc":
                            RR_WildSpawnType = "INFECTED PMC|INFECTED";
                            break;
                        case "infectedCivil":
                            RR_WildSpawnType = "INFECTED CIVILIAN|INFECTED";
                            break;
                        case "infectedLaborant":
                            RR_WildSpawnType = "INFECTED LABORANT|INFECTED";
                            break;
                        case "infectedTagilla":
                            RR_WildSpawnType = "INFECTED TAGILLA|BOSS";
                            break;
                        case "spiritWinter":
                            RR_WildSpawnType = "SPIRIT WINTER|SPECIAL";
                            break;
                        case "spiritSpring":
                            RR_WildSpawnType = "SPIRIT SPRING|SPECIAL";
                            break;

                        // THE MERCENARY
                        case "mercenary":
                            RR_WildSpawnType = "MERCENARY|MERCENARY";
                            break;

                        // RUAF Come Home
                        case "ruafRifleman":
                            RR_WildSpawnType = "RUAF RIFLEMAN|RUAF";
                            break;
                        case "ruafRiflemanSenior":
                            RR_WildSpawnType = "RUAF SENIOR RIFLEMAN|RUAF";
                            break;
                        case "ruafAutorifleman":
                            RR_WildSpawnType = "RUAF AUTORIFLEMAN|RUAF";
                            break;
                        case "ruafGrenadier":
                            RR_WildSpawnType = "RUAF GRENADIER|RUAF";
                            break;
                        case "ruafMarksman":
                            RR_WildSpawnType = "RUAF MARKSMAN|RUAF";
                            break;
                        case "ruafMachinegunner":
                            RR_WildSpawnType = "RUAF MACHINEGUNNER|RUAF";
                            break;

                        // RUAF Hardcore - Remnant faction
                        case "remnantRifleman":
                            RR_WildSpawnType = "REMNANT RIFLEMAN|RUAF";
                            break;
                        case "remnantRiflemanSenior":
                            RR_WildSpawnType = "REMNANT SENIOR RIFLEMAN|RUAF";
                            break;
                        case "remnantAutorifleman":
                            RR_WildSpawnType = "REMNANT AUTORIFLEMAN|RUAF";
                            break;
                        case "remnantGrenadier":
                            RR_WildSpawnType = "REMNANT GRENADIER|RUAF";
                            break;
                        case "remnantMarksman":
                            RR_WildSpawnType = "REMNANT MARKSMAN|RUAF";
                            break;
                        case "remnantMachinegunner":
                            RR_WildSpawnType = "REMNANT MACHINEGUNNER|RUAF";
                            break;

                        // UNTAR Go Home
                        case "followeruntar":
                            RR_WildSpawnType = "UNTAR GUARD|UNTAR";
                            break;
                        case "bossuntarlead":
                            RR_WildSpawnType = "UNTAR SQUAD LEADER|UNTAR";
                            break;
                        case "followeruntarmarksman":
                            RR_WildSpawnType = "UNTAR MARKSMAN|UNTAR";
                            break;
                        case "bossuntarofficer":
                            RR_WildSpawnType = "UNTAR OFFICER|UNTAR";
                            break;

                        // Black Division
                        case "blackDivLead":
                            RR_WildSpawnType = "BLACK DIV LEAD|BLACKDIV";
                            break;
                        case "blackDivAssault":
                            RR_WildSpawnType = "BLACK DIV ASSAULT|BLACKDIV";
                            break;
                        case "blackDivBreacher":
                            RR_WildSpawnType = "BLACK DIV BREACHER|BLACKDIV";
                            break;
                        case "blackDivSupport":
                            RR_WildSpawnType = "BLACK DIV SUPPORT|BLACKDIV";
                            break;

                        // ISB faction mod (mirror of MapWildSpawnType in mod.cs)
                        case "ISBSpecialForces":
                            RR_WildSpawnType = "ISB SPECIAL FORCES|ISB";
                            break;
                        case "ISBTeamLeader":
                            RR_WildSpawnType = "ISB TEAM LEADER|ISB";
                            break;
                        case "ISBSecondLeader":
                            RR_WildSpawnType = "ISB SECOND LEADER|ISB";
                            break;
                        case "ISBFirefly":
                            RR_WildSpawnType = "ISB FIREFLY|ISB";
                            break;
                        case "ISBFireflyFollowerLoghan":
                            RR_WildSpawnType = "ISB FIREFLY LOGHAN|ISB";
                            break;
                        case "ISBFireflyFollowerVipper":
                            RR_WildSpawnType = "ISB FIREFLY VIPPER|ISB";
                            break;
                        case "ISBFireflyShielder01":
                            RR_WildSpawnType = "ISB FIREFLY SHIELDER 1|ISB";
                            break;
                        case "ISBFireflyShielder02":
                            RR_WildSpawnType = "ISB FIREFLY SHIELDER 2|ISB";
                            break;

                        // Manimal's Combine Soldiers (keep in sync with MapWildSpawnType in mod.cs)
                        case "CombineSoldier":
                            RR_WildSpawnType = "COMBINE SOLDIER|COMBINE";
                            break;
                        case "CombineShotgunner":
                            RR_WildSpawnType = "COMBINE SHOTGUNNER|COMBINE";
                            break;
                        case "CombineElite":
                            RR_WildSpawnType = "COMBINE ELITE|COMBINE";
                            break;

                        default:
                            // Graceful fallback for unknown custom faction mods
                            RR_WildSpawnType = wildSpawnType.ToString().ToUpper() + "|FACTION_MOD";
                            break;
                    }
                }

                // If verison 2.3.3 or later, use the `isPlayerSav` method.
                if (isPlayerScav)
                {
                    RR_WildSpawnType = "PLAYER_SCAV|SCAV";
                }

                // If no specific type was identified, but the 'IsBoss' flag is true, return a 'boss'
                if (RR_WildSpawnType == "UNKNOWN" && isBoss)
                {
                    RR_WildSpawnType = "CUSTOM|BOSS";
                }
            }

            return RR_WildSpawnType;
        }

        // Reads SAIN's per-WildSpawnType display name (e.g. "ISB Operator") from SAIN's
        // static BotTypeDefinitions registry. MoreBotsAPI copies a faction mod's custom
        // SAIN settings into SAIN's native BotType (keyed by WildSpawnType), so this is the
        // author-controlled name shown in SAIN's settings menu. Returns "" when SAIN isn't
        // present or the type isn't registered (we use ContainsKey, never GetBotType, to
        // avoid SAIN's "assault"/Scav fallback).
        public static string getSainBotTypeName(object profile)
        {
            try
            {
                if (profile == null) return "";

                var wildSpawnType = profile.GetType().GetProperty("WildSpawnType")?.GetValue(profile)
                                 ?? profile.GetType().GetField("WildSpawnType")?.GetValue(profile);
                if (wildSpawnType == null) return "";

                Type botTypeDefsType = Type.GetType("SAIN.Preset.BotTypeDefinitions, SAIN");
                var botTypes = botTypeDefsType?.GetField("BotTypes", BindingFlags.Public | BindingFlags.Static)?.GetValue(null) as IDictionary;
                if (botTypes == null || !botTypes.Contains(wildSpawnType)) return "";

                var botType = botTypes[wildSpawnType];
                var name = botType?.GetType().GetField("Name", BindingFlags.Public | BindingFlags.Instance)?.GetValue(botType) as string;
                return name ?? "";
            }
            catch (Exception e)
            {
                LoggerInstance.Log?.LogError($"RAID_REVIEW :::: ERROR :::: getSainBotTypeName: {e}");
                return "";
            }
        }


    }

}