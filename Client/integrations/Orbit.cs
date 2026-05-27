using EFT;
using Orbit.Api;

namespace RAID_REVIEW
{
    /// <summary>
    /// Direct consumer of the ORBIT public telemetry API (<see cref="OrbitTelemetry"/>).
    /// Replaces the previous reflection-based integration — ORBIT now ships
    /// a stable API surface as part of its public DLL, and we link against
    /// it directly. Caller (mod.cs) must gate every entry point on
    /// <see cref="RAID_REVIEW.ORBIT__DETECTED"/> so the JIT only resolves
    /// the <c>Orbit.Api.*</c> assembly when the mod is actually installed —
    /// each method here JITs on first call, so an unguarded call without
    /// ORBIT on disk would throw a TypeLoadException.
    /// </summary>
    class Orbit_Integration
    {
        /// <summary>Kept for API symmetry with the legacy Phobos_Integration.
        /// The new API doesn't need any per-raid reflection bootstrap, so
        /// this is just a probe log.</summary>
        public static void InitReflection()
        {
            if (OrbitTelemetry.IsAvailable)
                LoggerInstance.Log.LogInfo("RAID_REVIEW :::: ORBIT :::: API ready");
        }

        /// <summary>No-op in the API-based integration — the API resolves
        /// agents directly from the live OrbitManager each call. Kept so
        /// the per-tick caller in mod.cs doesn't need a special-case.</summary>
        public static void RefreshAgentCache() { }

        public static TrackingOrbitBotObjective GetBotObjectiveData(Player player, string sessionId, long time)
        {
            if (player == null || !player.IsAI) return null;
            var data = OrbitTelemetry.GetBotObjective(player.ProfileId);
            if (data == null) return null;

            return new TrackingOrbitBotObjective
            {
                sessionId = sessionId,
                profileId = player.ProfileId,
                time = time,
                status = data.Status,
                category = data.Category,
                isLeader = data.IsLeader,
                objectiveX = data.ObjectiveX,
                objectiveY = data.ObjectiveY,
                objectiveZ = data.ObjectiveZ,
                extractReason = data.ExtractReason,
            };
        }

        public static TrackingOrbitField GetAdvectionFieldSnapshot(string sessionId, long time)
        {
            var snap = OrbitTelemetry.GetFieldSnapshot();
            if (snap == null) return null;

            var advection = new System.Collections.Generic.List<TrackingOrbitCell>(snap.Advection.Count);
            foreach (var c in snap.Advection)
                advection.Add(new TrackingOrbitCell { x = c.X, y = c.Y, fx = c.Fx, fz = c.Fz });

            var zones = new System.Collections.Generic.List<TrackingOrbitZone>(snap.Zones.Count);
            foreach (var z in snap.Zones)
                zones.Add(new TrackingOrbitZone { x = z.X, y = z.Y, radius = z.Radius, force = z.Force, decay = z.Decay });

            return new TrackingOrbitField
            {
                sessionId = sessionId,
                time = time,
                gridCols = snap.GridCols,
                gridRows = snap.GridRows,
                worldMinX = snap.WorldMinX,
                worldMinZ = snap.WorldMinZ,
                cellSize = snap.CellSize,
                advection = advection,
                zones = zones,
            };
        }

        public static TrackingOrbitMainObjectives GetMainObjectivesSnapshot(string sessionId, long time)
        {
            var snap = OrbitTelemetry.GetMainObjectivesSnapshot();
            if (snap == null || snap.Count == 0) return null;

            var squads = new System.Collections.Generic.List<TrackingOrbitSquadMainObjectives>(snap.Count);
            foreach (var s in snap)
            {
                var mains = new System.Collections.Generic.List<TrackingOrbitMainObjective>(s.MainObjectives.Count);
                foreach (var m in s.MainObjectives)
                {
                    mains.Add(new TrackingOrbitMainObjective
                    {
                        type = m.Type,
                        cellX = m.CellX,
                        cellY = m.CellY,
                        x = m.X,
                        y = m.Y,
                        z = m.Z,
                        completed = m.Completed,
                        killsRoamStartedAt = m.KillsRoamStartedAt,
                        killsRoamTargetDuration = m.KillsRoamTargetDuration,
                        lootValueEnteredAt = m.LootValueEnteredAt,
                        lootValueTotal = m.LootValueTotal,
                        lootValueInterrupted = m.LootValueInterrupted,
                        questTriggerId = m.QuestTriggerId,
                        questTitle = m.QuestTitle,
                    });
                }

                squads.Add(new TrackingOrbitSquadMainObjectives
                {
                    squadId = s.SquadId,
                    memberProfileIds = s.MemberProfileIds,
                    mainObjectives = mains,
                });
            }

            return new TrackingOrbitMainObjectives
            {
                sessionId = sessionId,
                time = time,
                squads = squads,
            };
        }
    }
}
