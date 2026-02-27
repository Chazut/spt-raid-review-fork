
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
                LoggerInstance.Log.LogInfo("RAID_REVIEW :::: INFO :::: Finished Searching For Supported Mods");
            }
            LoggerInstance.Log.LogInfo("RAID_REVIEW :::: INFO :::: RAID Settings Loaded");
        }
    }
}