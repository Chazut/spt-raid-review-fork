using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using Comfort.Common;
using EFT;

namespace RAID_REVIEW
{
    /// <summary>
    /// Reads bot objective data from the upstream Phobos AI mod
    /// (com.janky.phobos, assembly "Phobos"). Legacy / unsupported —
    /// opt-in via the EnableLegacyPhobos config toggle. The supported
    /// AI integration is in <see cref="Orbit_Integration"/>; the two
    /// paths stay independent so a future cleanup of this class won't
    /// touch the ORBIT code.
    /// </summary>
    class Phobos_Integration
    {
        // Locked to the upstream Phobos assembly.
        private const string AssemblyName = "Phobos";

        private static Type ResolvePhobosType(string typeFullName)
        {
            return Type.GetType($"{typeFullName}, {AssemblyName}");
        }

        private static bool _reflectionInit = false;
        private static bool _available = false;

        // Singleton<PhobosManager>.Instance access
        private static PropertyInfo _singletonInstanceProp;
        // PhobosManager.AgentData -> AgentData.Entities -> EntityArray.Values (List<Agent>)
        private static FieldInfo _agentDataField;
        private static FieldInfo _entitiesField;
        private static FieldInfo _valuesField;
        // Agent fields/props
        private static FieldInfo _agentIsActiveField;
        private static FieldInfo _agentIsLeaderField;
        private static FieldInfo _agentPlayerField;
        private static FieldInfo _agentObjectiveField;
        // Objective fields
        private static FieldInfo _objStatusField;
        private static FieldInfo _objLocationField;
        // Location fields
        private static FieldInfo _locPositionField;
        private static FieldInfo _locCategoryField;

        // Advection field (LocationSystem) reflection
        private static FieldInfo _locationSystemField;
        private static PropertyInfo _gridSizeProp;
        private static PropertyInfo _worldMinProp;
        private static PropertyInfo _cellSizeProp;
        private static PropertyInfo _advectionFieldProp;
        private static PropertyInfo _convergenceFieldProp;
        private static PropertyInfo _zonesProp;
        // POI snapshot reflection (LocationSystem._cells -> Cell -> Locations)
        private static FieldInfo _cellsField;
        private static FieldInfo _cellLocationsField;
        private static FieldInfo _locationIdField;
        private static FieldInfo _locationNameField;
        private static FieldInfo _zoneCoordsField;
        private static FieldInfo _zoneRadiusField;
        private static FieldInfo _zoneForceField;
        private static FieldInfo _zoneDecayField;

        public static void InitReflection()
        {
            if (_reflectionInit) return;
            _reflectionInit = true;

            try
            {
                var phobosManagerType = ResolvePhobosType("Phobos.Orchestration.PhobosManager");
                if (phobosManagerType == null)
                {
                    LoggerInstance.Log.LogWarning("RAID_REVIEW :::: PHOBOS :::: PhobosManager type not found in any known Phobos assembly");
                    return;
                }
                LoggerInstance.Log.LogInfo($"RAID_REVIEW :::: PHOBOS :::: Resolved Phobos types from assembly '{AssemblyName}'");

                // Singleton<PhobosManager>.Instance
                var singletonClosed = typeof(Singleton<>).MakeGenericType(phobosManagerType);
                _singletonInstanceProp = singletonClosed.GetProperty("Instance", BindingFlags.Public | BindingFlags.Static);

                _agentDataField = phobosManagerType.GetField("AgentData", BindingFlags.Public | BindingFlags.Instance);
                if (_agentDataField == null)
                {
                    LoggerInstance.Log.LogWarning("RAID_REVIEW :::: PHOBOS :::: AgentData field not found");
                    return;
                }

                // AgentData : Dataset<Agent, AgentArray> — Entities is on the Dataset base
                var agentDataType = _agentDataField.FieldType;
                _entitiesField = agentDataType.GetField("Entities", BindingFlags.Public | BindingFlags.Instance);
                if (_entitiesField == null)
                {
                    LoggerInstance.Log.LogWarning("RAID_REVIEW :::: PHOBOS :::: Entities field not found");
                    return;
                }

                // AgentArray : EntityArray<Agent> — Values is on the EntityArray base
                var agentArrayType = _entitiesField.FieldType;
                _valuesField = agentArrayType.GetField("Values", BindingFlags.Public | BindingFlags.Instance);
                if (_valuesField == null)
                {
                    LoggerInstance.Log.LogWarning("RAID_REVIEW :::: PHOBOS :::: Values field not found");
                    return;
                }

                var agentType = ResolvePhobosType("Phobos.Entities.Agent");
                if (agentType == null)
                {
                    LoggerInstance.Log.LogWarning("RAID_REVIEW :::: PHOBOS :::: Agent type not found");
                    return;
                }
                _agentIsActiveField = agentType.GetField("IsActive", BindingFlags.Public | BindingFlags.Instance);
                _agentIsLeaderField = agentType.GetField("IsLeader", BindingFlags.Public | BindingFlags.Instance);
                _agentPlayerField = agentType.GetField("Player", BindingFlags.Public | BindingFlags.Instance);
                _agentObjectiveField = agentType.GetField("Objective", BindingFlags.Public | BindingFlags.Instance);

                if (_agentObjectiveField != null)
                {
                    var objectiveType = _agentObjectiveField.FieldType;
                    _objStatusField = objectiveType.GetField("Status", BindingFlags.Public | BindingFlags.Instance);
                    _objLocationField = objectiveType.GetField("Location", BindingFlags.Public | BindingFlags.Instance);

                    if (_objLocationField != null)
                    {
                        var locationType = _objLocationField.FieldType;
                        _locPositionField = locationType.GetField("Position", BindingFlags.Public | BindingFlags.Instance);
                        _locCategoryField = locationType.GetField("Category", BindingFlags.Public | BindingFlags.Instance);
                    }
                }

                // LocationSystem (advection field) — exposed via PhobosManager.LocationSystem
                _locationSystemField = phobosManagerType.GetField("LocationSystem", BindingFlags.Public | BindingFlags.Instance);
                if (_locationSystemField != null)
                {
                    var locationSystemType = _locationSystemField.FieldType;
                    _gridSizeProp = locationSystemType.GetProperty("GridSize", BindingFlags.Public | BindingFlags.Instance);
                    _worldMinProp = locationSystemType.GetProperty("WorldMin", BindingFlags.Public | BindingFlags.Instance);
                    _cellSizeProp = locationSystemType.GetProperty("CellSize", BindingFlags.Public | BindingFlags.Instance);
                    _advectionFieldProp = locationSystemType.GetProperty("AdvectionField", BindingFlags.Public | BindingFlags.Instance);
                    _convergenceFieldProp = locationSystemType.GetProperty("ConvergenceField", BindingFlags.Public | BindingFlags.Instance);
                    _zonesProp = locationSystemType.GetProperty("Zones", BindingFlags.Public | BindingFlags.Instance);

                    var zoneType = ResolvePhobosType("Phobos.Systems.LocationSystem+Zone");
                    if (zoneType != null)
                    {
                        _zoneCoordsField = zoneType.GetField("Coords", BindingFlags.Public | BindingFlags.Instance);
                        _zoneRadiusField = zoneType.GetField("Radius", BindingFlags.Public | BindingFlags.Instance);
                        _zoneForceField = zoneType.GetField("Force", BindingFlags.Public | BindingFlags.Instance);
                        _zoneDecayField = zoneType.GetField("Decay", BindingFlags.Public | BindingFlags.Instance);
                    }

                    // _cells is private inside LocationSystem (Cell[,]). We
                    // need NonPublic access to walk it for the POI snapshot.
                    _cellsField = locationSystemType.GetField("_cells", BindingFlags.NonPublic | BindingFlags.Instance);
                    var cellType = ResolvePhobosType("Phobos.Systems.LocationSystem+Cell")
                                   ?? ResolvePhobosType("Phobos.Systems.Cell");
                    if (cellType != null)
                    {
                        _cellLocationsField = cellType.GetField("Locations", BindingFlags.Public | BindingFlags.Instance);
                    }
                    var locType = ResolvePhobosType("Phobos.Navigation.Location");
                    if (locType != null)
                    {
                        _locationIdField = locType.GetField("Id", BindingFlags.Public | BindingFlags.Instance);
                        _locationNameField = locType.GetField("Name", BindingFlags.Public | BindingFlags.Instance);
                    }
                }

                _available = _singletonInstanceProp != null && _agentPlayerField != null
                    && _agentObjectiveField != null && _objStatusField != null;

                LoggerInstance.Log.LogInfo($"RAID_REVIEW :::: PHOBOS :::: Reflection init OK — " +
                    $"Instance={_singletonInstanceProp != null}, AgentData={_agentDataField != null}, " +
                    $"Entities={_entitiesField != null}, Values={_valuesField != null}, " +
                    $"IsActive={_agentIsActiveField != null}, IsLeader={_agentIsLeaderField != null}, " +
                    $"Player={_agentPlayerField != null}, Objective={_agentObjectiveField != null}, " +
                    $"Status={_objStatusField != null}, Location={_objLocationField != null}, " +
                    $"LocPos={_locPositionField != null}, LocCat={_locCategoryField != null}, " +
                    $"LocationSystem={_locationSystemField != null}, AdvectionField={_advectionFieldProp != null}, " +
                    $"Zones={_zonesProp != null}, ZoneCoords={_zoneCoordsField != null}");
            }
            catch (Exception ex)
            {
                LoggerInstance.Log.LogWarning($"RAID_REVIEW :::: PHOBOS :::: Reflection init failed: {ex.Message}");
            }
        }

        // Cache: profileId -> Phobos Agent object (rebuilt each position tick)
        private static Dictionary<string, object> _agentCache = new Dictionary<string, object>();

        public static void RefreshAgentCache()
        {
            _agentCache.Clear();
            if (!_available) return;

            try
            {
                var manager = _singletonInstanceProp.GetValue(null);
                if (manager == null) return;

                var agentData = _agentDataField.GetValue(manager);
                if (agentData == null) return;

                var entities = _entitiesField.GetValue(agentData);
                if (entities == null) return;

                var values = _valuesField.GetValue(entities) as IEnumerable;
                if (values == null) return;

                foreach (var agent in values)
                {
                    if (agent == null) continue;
                    try
                    {
                        var player = _agentPlayerField.GetValue(agent) as Player;
                        if (player != null && !string.IsNullOrEmpty(player.ProfileId))
                            _agentCache[player.ProfileId] = agent;
                    }
                    catch { }
                }
            }
            catch (Exception ex)
            {
                LoggerInstance.Log.LogError($"RAID_REVIEW :::: PHOBOS :::: RefreshAgentCache failed: {ex.Message}");
            }
        }

        /// <summary>
        /// Extract current objective data for a bot. Returns null if the bot is not
        /// managed by Phobos or has no active objective.
        /// </summary>
        public static TrackingBotObjective GetBotObjectiveData(Player player, string sessionId, long time)
        {
            if (!_available || player == null || !player.IsAI) return null;

            try
            {
                if (!_agentCache.TryGetValue(player.ProfileId, out var agent) || agent == null)
                    return null;

                // Skip inactive agents
                if (_agentIsActiveField != null)
                {
                    var active = _agentIsActiveField.GetValue(agent);
                    if (active is false) return null;
                }

                var isLeader = false;
                if (_agentIsLeaderField != null)
                {
                    var lead = _agentIsLeaderField.GetValue(agent);
                    if (lead is true) isLeader = true;
                }

                var objective = _agentObjectiveField.GetValue(agent);
                if (objective == null) return null;

                var status = _objStatusField.GetValue(objective)?.ToString() ?? "None";

                // Location can be null when the bot has no destination yet
                var category = "";
                float objX = 0, objY = 0, objZ = 0;
                var location = _objLocationField?.GetValue(objective);
                if (location != null)
                {
                    category = _locCategoryField?.GetValue(location)?.ToString() ?? "";
                    var posObj = _locPositionField?.GetValue(location);
                    if (posObj is UnityEngine.Vector3 pos)
                    {
                        objX = pos.x; objY = pos.y; objZ = pos.z;
                    }
                }

                return new TrackingBotObjective
                {
                    sessionId = sessionId,
                    profileId = player.ProfileId,
                    time = time,
                    status = status,
                    category = category,
                    isLeader = isLeader,
                    objectiveX = objX,
                    objectiveY = objY,
                    objectiveZ = objZ
                };
            }
            catch (Exception ex)
            {
                LoggerInstance.Log.LogError($"RAID_REVIEW :::: PHOBOS :::: Error extracting objective for {player.ProfileId}: {ex.Message}");
                return null;
            }
        }

        // Extract the non-zero cells of a Vector2[,] grid field into a flat list.
        private static List<TrackingPhobosCell> ExtractField(Array field, int cols, int rows)
        {
            var cells = new List<TrackingPhobosCell>();
            if (field == null) return cells;
            for (var x = 0; x < cols; x++)
            {
                for (var y = 0; y < rows; y++)
                {
                    var v = (UnityEngine.Vector2)field.GetValue(x, y);
                    // Skip near-zero cells to keep the payload small
                    if (v.x * v.x + v.y * v.y < 0.0001f) continue;
                    cells.Add(new TrackingPhobosCell { x = x, y = y, fx = v.x, fz = v.y });
                }
            }
            return cells;
        }

        /// <summary>
        /// Capture a snapshot of the advection field, the player convergence field,
        /// and the hot zones. The advection field is mostly static but the convergence
        /// field tracks the players and is recalculated every ~30s by Phobos, so this
        /// should be called periodically during the raid.
        /// Returns null if Phobos or the LocationSystem isn't available yet.
        /// </summary>
        public static TrackingPhobosField GetAdvectionFieldSnapshot(string sessionId, long time)
        {
            if (!_available || _locationSystemField == null || _advectionFieldProp == null)
                return null;

            try
            {
                var manager = _singletonInstanceProp.GetValue(null);
                if (manager == null) return null;

                var locationSystem = _locationSystemField.GetValue(manager);
                if (locationSystem == null) return null;

                // GridSize (Vector2Int), WorldMin (Vector2), CellSize (float)
                var gridSizeObj = _gridSizeProp?.GetValue(locationSystem);
                var worldMinObj = _worldMinProp?.GetValue(locationSystem);
                var cellSizeObj = _cellSizeProp?.GetValue(locationSystem);
                if (gridSizeObj == null || worldMinObj == null || cellSizeObj == null) return null;

                var gridSize = (UnityEngine.Vector2Int)gridSizeObj;
                var worldMin = (UnityEngine.Vector2)worldMinObj;
                var cellSize = (float)cellSizeObj;

                var advection = ExtractField(_advectionFieldProp.GetValue(locationSystem) as Array, gridSize.x, gridSize.y);
                var convergence = ExtractField(_convergenceFieldProp?.GetValue(locationSystem) as Array, gridSize.x, gridSize.y);

                // Zones (List<LocationSystem.Zone>)
                var zones = new List<TrackingPhobosZone>();
                var zonesList = _zonesProp?.GetValue(locationSystem) as IEnumerable;
                if (zonesList != null && _zoneCoordsField != null)
                {
                    foreach (var zone in zonesList)
                    {
                        if (zone == null) continue;
                        var coords = (UnityEngine.Vector2Int)_zoneCoordsField.GetValue(zone);
                        var radius = _zoneRadiusField != null ? (float)_zoneRadiusField.GetValue(zone) : 0f;
                        var force = _zoneForceField != null ? (float)_zoneForceField.GetValue(zone) : 0f;
                        var decay = _zoneDecayField != null ? (float)_zoneDecayField.GetValue(zone) : 0f;
                        zones.Add(new TrackingPhobosZone
                        {
                            x = coords.x, y = coords.y,
                            radius = radius, force = force, decay = decay
                        });
                    }
                }

                // Field not ready yet (captured before LocationSystem finished computing) — retry next tick
                if (advection.Count == 0 && convergence.Count == 0 && zones.Count == 0)
                    return null;

                return new TrackingPhobosField
                {
                    sessionId = sessionId,
                    time = time,
                    gridCols = gridSize.x,
                    gridRows = gridSize.y,
                    worldMinX = worldMin.x,
                    worldMinZ = worldMin.y,
                    cellSize = cellSize,
                    advection = advection,
                    convergence = convergence,
                    zones = zones
                };
            }
            catch (Exception ex)
            {
                LoggerInstance.Log.LogError($"RAID_REVIEW :::: PHOBOS :::: GetAdvectionFieldSnapshot failed: {ex.Message}");
                return null;
            }
        }

    }
}
