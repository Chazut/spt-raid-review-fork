
namespace RAID_REVIEW {
    public static class Integrations {
        public static void ModCheck()
        {
            if (!RAID_REVIEW.MODS_SEARCHED)
            {
                LoggerInstance.Log.LogInfo("RAID_REVIEW :::: INFO :::: Searching For Supported Mods");
                RAID_REVIEW.MODS_SEARCHED = true;
                if (RAID_REVIEW.DetectMod("me.sol.sain"))
                {
                    LoggerInstance.Log.LogInfo("RAID_REVIEW :::: INFO :::: Found 'SAIN' Enabling Plugin Features for SAIN.");
                    RAID_REVIEW.SOLARINT_SAIN__DETECTED = true;
                    RAID_REVIEW.RAID_REVIEW__DETECTED_MODS.Add("SAIN");
                }
                if (RAID_REVIEW.DetectMod("me.skwizzy.lootingbots"))
                {
                    LoggerInstance.Log.LogInfo("RAID_REVIEW :::: INFO :::: Found 'LootingBots' Enabling Plugin Features for LootingBots.");
                    RAID_REVIEW.RAID_REVIEW__DETECTED_MODS.Add("LOOTING_BOTS");
                }
                // QuestingBots / legacy Phobos use reflection because neither
                // exposes a public API. Detection is always logged; capture
                // only runs when the matching F12 toggle is ON (default ON for
                // usability — users without these mods can flip them off).
                if (RAID_REVIEW.DetectMod("com.danw.questingbots"))
                {
                    if (RAID_REVIEW.EnableLegacyQuestingBots != null && RAID_REVIEW.EnableLegacyQuestingBots.Value)
                    {
                        LoggerInstance.Log.LogInfo("RAID_REVIEW :::: INFO :::: Found 'QuestingBots' — legacy integration enabled. NO SUPPORT — uses reflection. Disable in F12 if you see errors.");
                        RAID_REVIEW.DANW_QUESTINGBOTS__DETECTED = true;
                        RAID_REVIEW.RAID_REVIEW__DETECTED_MODS.Add("QUESTING_BOTS");
                    }
                    else
                    {
                        LoggerInstance.Log.LogInfo("RAID_REVIEW :::: INFO :::: Found 'QuestingBots' — legacy integration disabled by user toggle.");
                    }
                }
                if (RAID_REVIEW.DetectMod("com.janky.phobos"))
                {
                    if (RAID_REVIEW.EnableLegacyPhobos != null && RAID_REVIEW.EnableLegacyPhobos.Value)
                    {
                        LoggerInstance.Log.LogInfo("RAID_REVIEW :::: INFO :::: Found upstream 'Phobos' — legacy integration enabled. NO SUPPORT — uses reflection. Disable in F12 if you see errors.");
                        RAID_REVIEW.PHOBOS_LEGACY__DETECTED = true;
                        RAID_REVIEW.RAID_REVIEW__DETECTED_MODS.Add("PHOBOS_LEGACY");
                    }
                    else
                    {
                        LoggerInstance.Log.LogInfo("RAID_REVIEW :::: INFO :::: Found upstream 'Phobos' — legacy integration disabled by user toggle.");
                    }
                }
                // ORBIT (com.chazut.orbit) — the supported AI integration. Drives
                // the bot-objective overlay, advection-field viz, and per-squad
                // main-objective list.
                if (RAID_REVIEW.DetectMod("com.chazut.orbit"))
                {
                    LoggerInstance.Log.LogInfo("RAID_REVIEW :::: INFO :::: Found 'ORBIT' — enabling ORBIT integration.");
                    RAID_REVIEW.ORBIT__DETECTED = true;
                    RAID_REVIEW.RAID_REVIEW__DETECTED_MODS.Add("ORBIT");
                }
                if (RAID_REVIEW.DetectMod("de.salco.themercenary"))
                {
                    LoggerInstance.Log.LogInfo("RAID_REVIEW :::: INFO :::: Found 'THE MERCENARY'.");
                    RAID_REVIEW.RAID_REVIEW__DETECTED_MODS.Add("THE_MERCENARY");
                }
                if (RAID_REVIEW.DetectMod("com.ruafcomehome.tacticaltoaster"))
                {
                    LoggerInstance.Log.LogInfo("RAID_REVIEW :::: INFO :::: Found 'RUAF Come Home'.");
                    RAID_REVIEW.RAID_REVIEW__DETECTED_MODS.Add("RUAF_COME_HOME");
                }
                if (RAID_REVIEW.DetectMod("com.untargh.tacticaltoaster"))
                {
                    LoggerInstance.Log.LogInfo("RAID_REVIEW :::: INFO :::: Found 'UNTAR Go Home'.");
                    RAID_REVIEW.RAID_REVIEW__DETECTED_MODS.Add("UNTAR_GO_HOME");
                }
                if (RAID_REVIEW.DetectMod("com.blackdiv.tacticaltoaster"))
                {
                    LoggerInstance.Log.LogInfo("RAID_REVIEW :::: INFO :::: Found 'Black Division'.");
                    RAID_REVIEW.RAID_REVIEW__DETECTED_MODS.Add("BLACK_DIVISION");
                }
                // ISB SOF ships several plugins (ISBSpecialForces / ISBNotify / ISBSOF_Extras)
                // whose GUIDs vary by version and com.-prefix, so match any loaded plugin
                // whose GUID contains "isb" rather than guessing one exact id.
                if (RAID_REVIEW.DetectModContaining("isb"))
                {
                    LoggerInstance.Log.LogInfo("RAID_REVIEW :::: INFO :::: Found 'ISB SOF'.");
                    RAID_REVIEW.RAID_REVIEW__DETECTED_MODS.Add("ISB");
                }
                LoggerInstance.Log.LogInfo("RAID_REVIEW :::: INFO :::: Finished Searching For Supported Mods");
            }
            LoggerInstance.Log.LogInfo("RAID_REVIEW :::: INFO :::: RAID Settings Loaded");
        }
    }
}
