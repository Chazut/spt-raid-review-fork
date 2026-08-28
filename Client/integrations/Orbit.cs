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
        private static bool _apiReadyLogged;

        /// <summary>Kept for API symmetry with the legacy Phobos_Integration.
        /// The new API doesn't need any per-raid reflection bootstrap, so
        /// this is just a one-shot probe log per raid (caller invokes this
        /// every tick — without the latch we'd flood the log with thousands
        /// of identical "API ready" lines).</summary>
        public static void InitReflection()
        {
            if (_apiReadyLogged) return;
            if (!OrbitTelemetry.IsAvailable) return;
            LoggerInstance.Log.LogInfo("RAID_REVIEW :::: ORBIT :::: API ready");
            _apiReadyLogged = true;
        }

        /// <summary>Reset the one-shot init log when a new raid starts.
        /// Called from mod.cs's raid-start hook.</summary>
        public static void ResetSessionState()
        {
            _apiReadyLogged = false;
        }

        /// <summary>No-op in the API-based integration — the API resolves
        /// agents directly from the live OrbitManager each call. Kept so
        /// the per-tick caller in mod.cs doesn't need a special-case.</summary>
        public static void RefreshAgentCache() { }

        // ORBIT 2.0 ghost/limiter API availability. Older ORBIT builds (1.3.x) lack IsBotDormant and
        // DrainGhostFights: the first MissingMethod/TypeLoad flips this flag and every later call
        // returns instantly, so RR keeps working against old ORBIT with the ghost features inert
        // (no per-call exceptions, no log spam). The API calls live in NoInlining inner methods so
        // the JIT failure surfaces at OUR callsite where it can be caught.
        private static bool _ghostApiMissing;

        /// <summary>True while ORBIT's AI limiter has this bot as a ghost (body asleep, ORBIT still
        /// driving). Rides along every POSITION sample so the replay can fade ghost dots.</summary>
        public static bool IsBotGhost(Player player)
        {
            if (_ghostApiMissing || player == null || !player.IsAI) return false;
            try
            {
                return IsBotGhostInner(player.ProfileId);
            }
            catch (System.MissingMethodException)
            {
                _ghostApiMissing = true;
                LoggerInstance.Log.LogInfo("RAID_REVIEW :::: ORBIT :::: ghost/limiter API not present (ORBIT older than 2.0) — ghost features disabled");
                return false;
            }
            catch (System.TypeLoadException)
            {
                _ghostApiMissing = true;
                return false;
            }
        }

        [System.Runtime.CompilerServices.MethodImpl(System.Runtime.CompilerServices.MethodImplOptions.NoInlining)]
        private static bool IsBotGhostInner(string profileId)
            => OrbitTelemetry.IsBotDormant(profileId);

        /// <summary>Drains the simulated ghost fights resolved since the last call (null when none,
        /// or when the running ORBIT predates the 2.0 ghost API).</summary>
        public static System.Collections.Generic.List<TrackingOrbitGhostFight> GetGhostFights(string sessionId, long time)
        {
            if (_ghostApiMissing) return null;
            try
            {
                return GetGhostFightsInner(sessionId, time);
            }
            catch (System.MissingMethodException)
            {
                _ghostApiMissing = true;
                return null;
            }
            catch (System.TypeLoadException)
            {
                _ghostApiMissing = true;
                return null;
            }
        }

        [System.Runtime.CompilerServices.MethodImpl(System.Runtime.CompilerServices.MethodImplOptions.NoInlining)]
        private static System.Collections.Generic.List<TrackingOrbitGhostFight> GetGhostFightsInner(string sessionId, long time)
        {
            var drained = OrbitTelemetry.DrainGhostFights();
            if (drained == null) return null;
            var list = new System.Collections.Generic.List<TrackingOrbitGhostFight>(drained.Count);
            foreach (var f in drained)
            {
                list.Add(new TrackingOrbitGhostFight
                {
                    sessionId = sessionId,
                    time = time,
                    aX = f.AX, aY = f.AY, aZ = f.AZ,
                    bX = f.BX, bY = f.BY, bZ = f.BZ,
                    durationMs = (long)(f.Duration * 1000f),
                    casualties = f.Casualties,
                });
            }
            return list;
        }

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

        // ORBIT 2.0 changed OrbitFieldZone.X/Y from int to float. Against an older ORBIT the JIT of the
        // snapshot method throws MissingFieldException on every call — same one-shot guard as the ghost
        // API so the field overlay goes inert with a single log line instead of spamming per tick.
        private static bool _fieldApiMissing;

        public static TrackingOrbitField GetAdvectionFieldSnapshot(string sessionId, long time)
        {
            if (_fieldApiMissing) return null;
            try
            {
                return GetAdvectionFieldSnapshotInner(sessionId, time);
            }
            catch (System.MissingMemberException)
            {
                _fieldApiMissing = true;
                LoggerInstance.Log.LogInfo("RAID_REVIEW :::: ORBIT :::: field snapshot API mismatch (ORBIT older than 2.0) — hotspot field overlay disabled");
                return null;
            }
            catch (System.TypeLoadException)
            {
                _fieldApiMissing = true;
                return null;
            }
        }

        [System.Runtime.CompilerServices.MethodImpl(System.Runtime.CompilerServices.MethodImplOptions.NoInlining)]
        private static TrackingOrbitField GetAdvectionFieldSnapshotInner(string sessionId, long time)
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

        // ORBIT bumps this whenever a squad main flips Completed.
        public static int GetMainObjectivesRevision() => OrbitTelemetry.MainObjectivesRevision;
    }
}
