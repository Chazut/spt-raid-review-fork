using Newtonsoft.Json;
using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using EFT;

namespace RAID_REVIEW
{
    class QuestingBots_Integration
    {
        // Reflection cache
        private static bool _reflectionInit = false;
        private static bool _available = false;

        // BotJobAssignmentFactory extension methods (static)
        private static MethodInfo _getCurrentJobAssignmentMethod;

        // BotJobAssignment properties
        private static Type _botJobAssignmentType;
        private static PropertyInfo _jobStatusProp;
        private static PropertyInfo _jobPositionProp;
        private static PropertyInfo _jobQuestAssignmentProp;
        private static PropertyInfo _jobObjectiveStepProp;

        // Quest properties
        private static PropertyInfo _questNameProp;
        private static PropertyInfo _questIsEFTQuestProp;

        // QuestObjectiveStep properties
        private static PropertyInfo _stepActionTypeProp;

        // QuestAction enum type
        private static Type _questActionEnumType;

        public static void InitReflection()
        {
            if (_reflectionInit) return;
            _reflectionInit = true;

            // QB >= 0.11.0 ships an official interop surface (QuestingBotsExternal) — prefer it and
            // skip the unsupported legacy reflection entirely.
            if (QuestingBotsInterop.Init())
            {
                _available = true;
                LoggerInstance.Log.LogInfo("RAID_REVIEW :::: QUESTINGBOTS :::: Official interop detected (QB >= 0.11.0) — legacy reflection skipped");
                return;
            }

            try
            {
                // BotJobAssignmentFactory has extension methods on BotOwner
                var factoryType = Type.GetType("QuestingBots.Controllers.BotJobAssignmentFactory, QuestingBots-Client");
                if (factoryType == null)
                {
                    LoggerInstance.Log.LogWarning("RAID_REVIEW :::: QUESTINGBOTS :::: BotJobAssignmentFactory type not found");
                    return;
                }

                // GetCurrentJobAssignment(this BotOwner, bool allowUpdate = true)
                _getCurrentJobAssignmentMethod = factoryType.GetMethod("GetCurrentJobAssignment",
                    BindingFlags.Public | BindingFlags.Static,
                    null,
                    new Type[] { typeof(EFT.BotOwner), typeof(bool) },
                    null);

                if (_getCurrentJobAssignmentMethod == null)
                {
                    // Try single-arg overload
                    _getCurrentJobAssignmentMethod = factoryType.GetMethod("GetCurrentJobAssignment",
                        BindingFlags.Public | BindingFlags.Static);
                }

                if (_getCurrentJobAssignmentMethod == null)
                {
                    LoggerInstance.Log.LogWarning("RAID_REVIEW :::: QUESTINGBOTS :::: GetCurrentJobAssignment method not found");
                    return;
                }

                _botJobAssignmentType = _getCurrentJobAssignmentMethod.ReturnType;
                _jobStatusProp = _botJobAssignmentType.GetProperty("Status");
                _jobPositionProp = _botJobAssignmentType.GetProperty("Position");
                _jobQuestAssignmentProp = _botJobAssignmentType.GetProperty("QuestAssignment");
                _jobObjectiveStepProp = _botJobAssignmentType.GetProperty("QuestObjectiveStepAssignment");

                if (_jobQuestAssignmentProp != null)
                {
                    var questType = _jobQuestAssignmentProp.PropertyType;
                    _questNameProp = questType.GetProperty("Name");
                    _questIsEFTQuestProp = questType.GetProperty("IsEFTQuest");
                }

                if (_jobObjectiveStepProp != null)
                {
                    var stepType = _jobObjectiveStepProp.PropertyType;
                    _stepActionTypeProp = stepType.GetProperty("ActionType");
                    if (_stepActionTypeProp != null)
                        _questActionEnumType = _stepActionTypeProp.PropertyType;
                }

                _available = true;
                LoggerInstance.Log.LogInfo($"RAID_REVIEW :::: QUESTINGBOTS :::: Reflection init OK — " +
                    $"Assignment={_botJobAssignmentType != null}, Status={_jobStatusProp != null}, " +
                    $"Position={_jobPositionProp != null}, Quest={_jobQuestAssignmentProp != null}, " +
                    $"QuestName={_questNameProp != null}, IsEFT={_questIsEFTQuestProp != null}, " +
                    $"Step={_jobObjectiveStepProp != null}, ActionType={_stepActionTypeProp != null}");
            }
            catch (Exception ex)
            {
                LoggerInstance.Log.LogWarning($"RAID_REVIEW :::: QUESTINGBOTS :::: Reflection init failed: {ex.Message}");
            }
        }

        /// <summary>
        /// Extract current quest data for a bot. Returns null if bot has no active quest.
        /// </summary>
        public static TrackingBotQuest GetBotQuestData(Player player, string sessionId, long time)
        {
            if (!_available || player == null || !player.IsAI) return null;

            try
            {
                var botOwner = player.AIData?.BotOwner;
                if (botOwner == null) return null;

                // Official interop path (QB >= 0.11.0).
                if (QuestingBotsInterop.Init())
                {
                    var info = QuestingBotsInterop.GetBotQuestInfo(botOwner);
                    if (info == null || !info.IsValid) return null;

                    // No active quest: emit a single quiet "None" record so the timeline closes the
                    // previous quest, without churning on decision/action changes.
                    if (!info.HasAQuest)
                    {
                        return new TrackingBotQuest
                        {
                            sessionId = sessionId,
                            profileId = player.ProfileId,
                            time = time,
                            questName = "",
                            isEFTQuest = false,
                            actionType = "",
                            status = "None",
                            objectiveX = 0,
                            objectiveY = 0,
                            objectiveZ = 0
                        };
                    }

                    // The official surface exposes no assignment-status string; HasAQuest implies an
                    // active (Pending/Active) assignment, which is what the decision override keys on.
                    var loc = info.QuestLocation;
                    var hasLoc = !float.IsNegativeInfinity(loc.x);
                    return new TrackingBotQuest
                    {
                        sessionId = sessionId,
                        profileId = player.ProfileId,
                        time = time,
                        questName = info.QuestName,
                        isEFTQuest = info.IsEftQuest,
                        actionType = info.CurrentActionType,
                        status = "Active",
                        objectiveX = hasLoc ? loc.x : 0,
                        objectiveY = hasLoc ? loc.y : 0,
                        objectiveZ = hasLoc ? loc.z : 0
                    };
                }

                // Call GetCurrentJobAssignment(botOwner, false) — false = don't trigger reassignment
                object assignment;
                var paramCount = _getCurrentJobAssignmentMethod.GetParameters().Length;
                if (paramCount == 2)
                    assignment = _getCurrentJobAssignmentMethod.Invoke(null, new object[] { botOwner, false });
                else
                    assignment = _getCurrentJobAssignmentMethod.Invoke(null, new object[] { botOwner });

                if (assignment == null) return null;

                // Status
                var status = _jobStatusProp?.GetValue(assignment)?.ToString() ?? "Unknown";

                // Quest name & type
                var questName = "";
                var isEFTQuest = false;
                if (_jobQuestAssignmentProp != null)
                {
                    var quest = _jobQuestAssignmentProp.GetValue(assignment);
                    if (quest != null)
                    {
                        questName = _questNameProp?.GetValue(quest)?.ToString() ?? "";
                        var eftVal = _questIsEFTQuestProp?.GetValue(quest);
                        if (eftVal is bool b) isEFTQuest = b;
                    }
                }

                // Action type
                var actionType = "";
                if (_jobObjectiveStepProp != null)
                {
                    var step = _jobObjectiveStepProp.GetValue(assignment);
                    if (step != null && _stepActionTypeProp != null)
                    {
                        actionType = _stepActionTypeProp.GetValue(step)?.ToString() ?? "";
                    }
                }

                // Objective position (nullable Vector3)
                float objX = 0, objY = 0, objZ = 0;
                if (_jobPositionProp != null)
                {
                    var posObj = _jobPositionProp.GetValue(assignment);
                    if (posObj is UnityEngine.Vector3 pos)
                    {
                        objX = pos.x; objY = pos.y; objZ = pos.z;
                    }
                    else if (posObj != null)
                    {
                        // Nullable<Vector3> — unbox
                        try
                        {
                            var vec = (UnityEngine.Vector3)posObj;
                            objX = vec.x; objY = vec.y; objZ = vec.z;
                        }
                        catch { }
                    }
                }

                return new TrackingBotQuest
                {
                    sessionId = sessionId,
                    profileId = player.ProfileId,
                    time = time,
                    questName = questName,
                    isEFTQuest = isEFTQuest,
                    actionType = actionType,
                    status = status,
                    objectiveX = objX,
                    objectiveY = objY,
                    objectiveZ = objZ
                };
            }
            catch (Exception ex)
            {
                LoggerInstance.Log.LogError($"RAID_REVIEW :::: QUESTINGBOTS :::: Error extracting quest for {player.ProfileId}: {ex.Message}");
                return null;
            }
        }
    }
}
