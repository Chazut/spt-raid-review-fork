using BepInEx.Bootstrap;
using EFT;
using HarmonyLib;
using System;
using System.Collections.Generic;
using System.Reflection;
using UnityEngine;

namespace RAID_REVIEW
{
    // Official QuestingBots interop consumer, adapted from the upstream example
    // (SPTQuestingBots/Interop/Client-InteropTest/QuestingBotsInterop.cs). Talks to
    // QuestingBots.QuestingBotsExternal (shipped since QB 0.11.0) via cached reflection.
    // Older QB versions don't have the External class — Init() returns false and the
    // legacy reflection integration in QuestingBots.cs takes over.

    internal class QuestingBotsBotQuestInfo
    {
        public bool IsValid { get; private set; } = false;
        public string CurrentDecision { get; private set; } = string.Empty;
        public string CurrentActionType { get; private set; } = string.Empty;
        public string QuestName { get; private set; } = string.Empty;
        public Vector3 QuestLocation { get; private set; } = Vector3.negativeInfinity;
        public bool IsEftQuest { get; private set; } = false;

        public bool HasAQuest => QuestName != string.Empty;

        public QuestingBotsBotQuestInfo() { }

        public QuestingBotsBotQuestInfo(string currentDecision, string currentActionType) : this()
        {
            CurrentDecision = currentDecision;
            CurrentActionType = currentActionType;
            IsValid = true;
        }

        public QuestingBotsBotQuestInfo(string currentDecision, string currentActionType, string questName, Vector3 questLocation, bool isEftQuest) : this(currentDecision, currentActionType)
        {
            QuestName = questName;
            QuestLocation = questLocation;
            IsEftQuest = isEftQuest;
        }
    }

    internal class QuestingBotsBotJobAssignmentHistoryEntry
    {
        public bool IsValid { get; private set; } = false;
        public string StartTimestampText { get; private set; } = string.Empty;
        public string EndTimestampText { get; private set; } = string.Empty;
        public string QuestName { get; private set; } = string.Empty;
        public string QuestObjectiveName { get; private set; } = string.Empty;
        public string QuestStep { get; private set; } = string.Empty;
        public string Status { get; private set; } = string.Empty;

        public long StartTimestamp => long.Parse(StartTimestampText);
        public long EndTimestamp => long.Parse(EndTimestampText);

        public QuestingBotsBotJobAssignmentHistoryEntry() { }

        public QuestingBotsBotJobAssignmentHistoryEntry(string startTimestamp, string endTimestamp, string questName, string questObjectiveName, string questStep, string status) : this()
        {
            StartTimestampText = startTimestamp;
            EndTimestampText = endTimestamp;
            QuestName = questName;
            QuestObjectiveName = questObjectiveName;
            QuestStep = questStep;
            Status = status;
            IsValid = true;
        }
    }

    internal static class QuestingBotsInterop
    {
        private static bool _QuestingBotsLoadedChecked = false;
        private static bool _QuestingBotsInteropInited = false;

        private static bool _IsQuestingBotsLoaded;
        private static Type _QuestingBotsExternalType = null;

        private static MethodInfo _GetCurrentDecisionMethod = null;
        private static MethodInfo _GetCurrentQuestActionTypeMethod = null;
        private static MethodInfo _GetCurrentQuestNameMethod = null;
        private static MethodInfo _GetCurrentQuestLocationMethod = null;
        private static MethodInfo _IsCurrentJobAssignmentAnEftQuestMethod = null;
        private static MethodInfo _IsCurrentJobAssignmentActiveMethod = null;
        private static MethodInfo _HasAQuestingBossMethod = null;
        private static MethodInfo _GetJobAssignmentHistoryCsvDataMethod = null;

        public static bool IsQuestingBotsLoaded()
        {
            // Only check for Questing Bots once
            if (!_QuestingBotsLoadedChecked)
            {
                _QuestingBotsLoadedChecked = true;
                _IsQuestingBotsLoaded = Chainloader.PluginInfos.ContainsKey("com.danw.questingbots");
            }

            return _IsQuestingBotsLoaded;
        }

        /// <summary>
        /// Initialize the interop class data. Returns true when the External class exists (QB >= 0.11.0).
        /// </summary>
        public static bool Init()
        {
            if (!IsQuestingBotsLoaded()) return false;

            // Only check for the External class once
            if (!_QuestingBotsInteropInited)
            {
                _QuestingBotsInteropInited = true;

                _QuestingBotsExternalType = Type.GetType("QuestingBots.QuestingBotsExternal, QuestingBots-Client");

                if (_QuestingBotsExternalType != null)
                {
                    _GetCurrentDecisionMethod = AccessTools.Method(_QuestingBotsExternalType, "GetCurrentDecision");
                    _GetCurrentQuestActionTypeMethod = AccessTools.Method(_QuestingBotsExternalType, "GetCurrentQuestActionType");
                    _GetCurrentQuestNameMethod = AccessTools.Method(_QuestingBotsExternalType, "GetCurrentQuestName");
                    _GetCurrentQuestLocationMethod = AccessTools.Method(_QuestingBotsExternalType, "GetCurrentQuestLocation");
                    _IsCurrentJobAssignmentAnEftQuestMethod = AccessTools.Method(_QuestingBotsExternalType, "IsCurrentJobAssignmentAnEftQuest");
                    _IsCurrentJobAssignmentActiveMethod = AccessTools.Method(_QuestingBotsExternalType, "HasActiveJobAssignment");
                    _HasAQuestingBossMethod = AccessTools.Method(_QuestingBotsExternalType, "HasAQuestingBoss");
                    _GetJobAssignmentHistoryCsvDataMethod = AccessTools.Method(_QuestingBotsExternalType, "GetJobAssignmentHistoryCsvData");
                }
            }

            return (_QuestingBotsExternalType != null);
        }

        /// <summary>
        /// All current questing information for the specified bot.
        /// </summary>
        public static QuestingBotsBotQuestInfo GetBotQuestInfo(BotOwner bot)
        {
            if (!Init()) return new QuestingBotsBotQuestInfo();
            if (_GetCurrentDecisionMethod == null) return new QuestingBotsBotQuestInfo();
            if (_GetCurrentQuestActionTypeMethod == null) return new QuestingBotsBotQuestInfo();
            if (_GetCurrentQuestNameMethod == null) return new QuestingBotsBotQuestInfo();
            if (_GetCurrentQuestLocationMethod == null) return new QuestingBotsBotQuestInfo();
            if (_IsCurrentJobAssignmentAnEftQuestMethod == null) return new QuestingBotsBotQuestInfo();
            if (_IsCurrentJobAssignmentActiveMethod == null) return new QuestingBotsBotQuestInfo();
            if (_HasAQuestingBossMethod == null) return new QuestingBotsBotQuestInfo();

            string decision = (string)_GetCurrentDecisionMethod.Invoke(null, new object[] { bot });
            string actionType = (string)_GetCurrentQuestActionTypeMethod.Invoke(null, new object[] { bot });

            bool hasActiveJob = (bool)_IsCurrentJobAssignmentActiveMethod.Invoke(null, new object[] { bot });
            bool hasAQuestingBoss = (bool)_HasAQuestingBossMethod.Invoke(null, new object[] { bot });
            if (!hasActiveJob || hasAQuestingBoss)
            {
                return new QuestingBotsBotQuestInfo(decision, actionType);
            }

            string questName = (string)_GetCurrentQuestNameMethod.Invoke(null, new object[] { bot });
            Vector3 questLocation = (Vector3)_GetCurrentQuestLocationMethod.Invoke(null, new object[] { bot });
            bool isEftQuest = (bool)_IsCurrentJobAssignmentAnEftQuestMethod.Invoke(null, new object[] { bot });

            return new QuestingBotsBotQuestInfo(decision, actionType, questName, questLocation, isEftQuest);
        }

        /// <summary>
        /// Information about all job assignments for the specified bot (unused for now — kept in
        /// sync with the upstream interop example for future timeline work).
        /// </summary>
        public static IEnumerable<QuestingBotsBotJobAssignmentHistoryEntry> GetJobAssignmentHistory(BotOwner bot)
        {
            if (!Init()) yield break;
            if (_GetJobAssignmentHistoryCsvDataMethod == null) yield break;

            IEnumerable<string[]> historyCsvEntries = (IEnumerable<string[]>)_GetJobAssignmentHistoryCsvDataMethod.Invoke(null, new object[] { bot });
            foreach (string[] historyCsvEntry in historyCsvEntries)
            {
                yield return new QuestingBotsBotJobAssignmentHistoryEntry
                (
                    historyCsvEntry[0],
                    historyCsvEntry[1],
                    historyCsvEntry[2],
                    historyCsvEntry[3],
                    historyCsvEntry[4],
                    historyCsvEntry[5]
                );
            }
        }
    }
}
