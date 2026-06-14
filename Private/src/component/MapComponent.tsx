// @ts-nocheck

import { useEffect, useRef, useMemo, useCallback, useLayoutEffect, useState } from 'react';
import { useParams, useSearchParams, useNavigate, useLoaderData, Link } from 'react-router-dom';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import ResizeObserver from 'resize-observer-polyfill';
import _, { forIn, map, transform } from 'lodash';
import { start } from 'repl';
import L from 'leaflet';

import api from '../api/api.js';
import { msToHMS, intl } from '../helpers/index.js';
import { calculateNewPosition, findInsertIndex } from '../modules/utils.js'
import { useMapImages } from '../modules/maps-index.js';
import { TrackingPositionalData, TrackingLooseLootItem, TrackingPlayerInventoryItem } from '../types/api_types.js';
import { PlayerSlider } from './MapPlayerSlider.js';

import BotMapping from '../assets/botMapping.json'
import { getMarkerLabel, getPlayerColor, getLegendIcon, PMC_COLORS, buildPmcIndexMap, getFactionRole } from '../helpers/players'
import { getBehaviorCategory, BEHAVIOR_CATEGORIES, formatDecisionLabel } from '../helpers/botBehavior'

import 'leaflet/dist/leaflet.css';

const BOSS_NAME_OVERRIDES: Record<string, string> = {
    'Партизан': 'Partizan',
}

function getDisplayName(player: any): string {
    return BOSS_NAME_OVERRIDES[player?.name] || player?.name || 'Unknown'
}

function classifyPlayer(player: any): string {
    if (!player) return 'SCAV'
    const isPMC = player.team === 'Bear' || player.team === 'Usec'
    const isHuman = player.type === 'HUMAN'
    if (isPMC || isHuman) return 'PMC'

    let botMapping = BotMapping[player.type]
    if (player.name === 'Knight') botMapping = { type: 'GOON' }
    // Handle bots not in botMapping.json by inferring from the type string "NAME|CATEGORY"
    if (!botMapping && typeof player.type === 'string' && player.type.includes('|')) {
        const category = player.type.split('|')[1]
        const name = player.type.split('|')[0].toLowerCase()
        if (category === 'FACTION_MOD') {
            botMapping = { type: name.startsWith('boss') ? 'BOSS' : 'FOLLOWER' }
        } else {
            // Use the category directly (RUAF, UNTAR, SNIPER, etc.) — covers custom
            // faction-mod bots like Remnant that aren't explicitly mapped
            botMapping = { type: category }
        }
    }
    if (!botMapping) botMapping = { type: 'UNKNOWN' }

    switch (botMapping.type) {
        case 'PLAYER_SCAV': return 'PLAYER_SCAV'
        case 'BOSS': return 'BOSS'
        case 'GOON': return 'GOON'
        case 'FOLLOWER': return 'FOLLOWER'
        case 'RAIDER':
        case 'ROGUE':
        case 'CULT':
        case 'BLOODHOUND':
        case 'SNIPER':
        case 'INFECTED':
        case 'OTHER': return 'SPECIAL'
        case 'MERCENARY':
        case 'RUAF':
        case 'UNTAR':
        case 'BLACKDIV':
        case 'ISB': return 'FACTION'
        case 'SCAV':
        default:
            if (player.type === 'PLAYER' && player.team === 'Savage') return 'SCAV'
            return 'SCAV'
    }
}

const LEGEND_GROUPS = [
    { key: 'PMC', label: 'PMC' },
    { key: 'PLAYER_SCAV', label: 'Player Scav' },
    { key: 'BOSS', label: 'Boss' },
    { key: 'GOON', label: 'Goons' },
    { key: 'FOLLOWER', label: 'Followers' },
    { key: 'SPECIAL', label: 'Special' },
    { key: 'FACTION', label: 'Faction' },
    { key: 'SCAV', label: 'Scav' },
] as const

function getTooltipIconHtml(player: any, color: string, pmcIdx?: number): string {
    const label = getMarkerLabel(player)
    if (label && label !== 'BTR_ICON') {
        return `<span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:${color};text-align:center;font-size:7px;font-weight:bold;color:#fff;line-height:12px;vertical-align:middle;margin-right:3px;">${label}</span>`
    }
    if (pmcIdx !== undefined) {
        return `<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${color};text-align:center;font-size:7px;font-weight:bold;color:#fff;line-height:12px;vertical-align:middle;margin-right:3px;border:1px solid rgba(255,255,255,0.6);">${pmcIdx}</span>`
    }
    return `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};vertical-align:middle;margin-right:3px;"></span>`
}

function formatCompactNumber(value: number): string {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
    if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`
    return String(value)
}

function getLootPriceColor(totalPrice: number): string {
    if (totalPrice >= 500_000) return '#FFD700'  // gold
    if (totalPrice >= 100_000) return '#A855F7'  // purple
    if (totalPrice >= 50_000) return '#3B82F6'   // blue
    if (totalPrice >= 10_000) return '#94A3B8'   // light slate (brighter than old gray)
    return '#64748B'                              // slate
}

// Resolves a Phobos Quest POI's trigger.gameObject.name (e.g.
// "expl_zone_vremyan_case") to a friendly quest title via the
// server-built zoneId → title map. SPT quests reference zones by
// their bare id ("vremyan_case"), but the Unity gameObject often
// prefixes them ("expl_zone_", "place_", "quest_terminal_"…). Match
// strategy: exact first, then suffix (triggerName ends with zoneId
// in the map), then substring. Returns null if no match.
function resolveQuestName(triggerName: string, map: Record<string, string>): string | null {
    if (!triggerName || !map) return null
    if (map[triggerName]) return map[triggerName]
    let best: string | null = null
    let bestLen = 0
    for (const zoneId of Object.keys(map)) {
        if (zoneId.length < 4) continue // skip 1-2 char numeric ids that match anything
        if (triggerName === zoneId
            || triggerName.endsWith(zoneId)
            || triggerName.includes(zoneId)) {
            if (zoneId.length > bestLen) { best = map[zoneId]; bestLen = zoneId.length }
        }
    }
    return best
}

// Builds the divIcon for a player dot plus the raw html string used for it, so
// callers can cheaply detect when the icon actually changed between frames and
// avoid a needless setIcon (which swaps the DOM element and disrupts an open
// tooltip — see issue #24).
function buildPlayerIcon(color: string, player: any, proportionalScale: number, opacity: number, pmcIndex?: number, behaviorColor?: string | null, hpPercent?: number): { icon: L.DivIcon, html: string } {
    const ringStyle = behaviorColor ? `box-shadow: 0 0 0 3px ${behaviorColor}, 0 0 6px 1px ${behaviorColor}55;` : ''
    // HP fill: gradient from bottom (color) to top (dark) based on HP percentage
    const hp = hpPercent != null ? Math.max(0, Math.min(100, hpPercent)) : 100
    const bgStyle = hp < 100
        ? `background: linear-gradient(to top, ${color} ${hp}%, rgba(30,30,30,0.8) ${hp}%);`
        : `background-color: ${color};`
    const label = getMarkerLabel(player)
    if (label === 'BTR_ICON') {
        const btrSvg = `<svg viewBox="0 0 24 18" width="24" height="18" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="3" width="20" height="8" rx="1" fill="${color}" opacity="${opacity}"/><rect x="5" y="1" width="10" height="4" rx="1" fill="${color}" opacity="${opacity}"/><line x1="15" y1="3" x2="20" y2="5" stroke="${color}" stroke-width="1.2" opacity="${opacity}"/><circle cx="5.5" cy="13.5" r="2.5" fill="${color}" opacity="${opacity}"/><circle cx="12" cy="13.5" r="2.5" fill="${color}" opacity="${opacity}"/><circle cx="18.5" cy="13.5" r="2.5" fill="${color}" opacity="${opacity}"/><circle cx="5.5" cy="13.5" r="1" fill="#1a1a1a"/><circle cx="12" cy="13.5" r="1" fill="#1a1a1a"/><circle cx="18.5" cy="13.5" r="1" fill="#1a1a1a"/></svg>`
        const html = `<div style="display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 0 2px rgba(0,0,0,0.9));${ringStyle}">${btrSvg}</div>`
        return { icon: L.divIcon({ className: 'special-bot-marker', html, iconSize: [24, 20], iconAnchor: [12, 10] }), html }
    }
    if (label) {
        const html = `<div class="bot-marker-dot" style="${bgStyle} opacity: ${opacity}; ${ringStyle}">${label}</div>`
        return { icon: L.divIcon({ className: 'special-bot-marker', html, iconSize: [18, 18], iconAnchor: [9, 9] }), html }
    }
    // PMCs and player scavs get white border + number label
    if (pmcIndex !== undefined) {
        const html = `<div class="bot-marker-dot bot-marker-round" style="${bgStyle} opacity: ${opacity}; ${ringStyle}">${pmcIndex}</div>`
        return { icon: L.divIcon({ className: 'special-bot-marker', html, iconSize: [18, 18], iconAnchor: [9, 9] }), html }
    }
    // Scavs: plain circle — always use divIcon for HP fill + behavior ring support
    const size = Math.max(10, proportionalScale * 2)
    const html = `<div style="width:${size}px;height:${size}px;border-radius:50%;${bgStyle}opacity:${opacity};${ringStyle}"></div>`
    return { icon: L.divIcon({ className: 'special-bot-marker', html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] }), html }
}

function createPlayerMarker(latlng: any, color: string, player: any, proportionalScale: number, opacity: number = 1, pmcIndex?: number, tooltipText?: string, behaviorColor?: string | null, hpPercent?: number): L.Marker {
    const displayName = tooltipText || getDisplayName(player)
    const tooltipOpts: L.TooltipOptions = { direction: 'top', offset: [0, -10], className: 'player-tooltip player-tooltip-html' }
    const { icon, html } = buildPlayerIcon(color, player, proportionalScale, opacity, pmcIndex, behaviorColor, hpPercent)
    const marker = L.marker(latlng, { icon, interactive: true }).bindTooltip(displayName, tooltipOpts) as L.Marker
    ;(marker as any)._rr_iconHtml = html
    ;(marker as any)._rr_baseTooltip = displayName
    return marker
}

// Mutates an existing persistent player marker in place rather than tearing it
// down + rebuilding it every playback frame (issue #24). Preserves the Leaflet
// layer + tooltip identity so the hovered/followed tooltip never flickers.
function updatePlayerMarker(marker: L.Marker, latlng: any, color: string, player: any, proportionalScale: number, opacity: number, pmcIndex: number | undefined, tooltipText: string, behaviorColor: string | null | undefined, hpPercent: number | undefined, isFocused: boolean): void {
    marker.setLatLng(latlng)
    const { icon, html } = buildPlayerIcon(color, player, proportionalScale, opacity, pmcIndex, behaviorColor, hpPercent)
    // Only swap the icon element when the visuals actually changed, and never
    // while this is the focused/hovered marker — setIcon recreates the DOM node
    // and would interrupt the open tooltip.
    if (html !== (marker as any)._rr_iconHtml && !isFocused) {
        marker.setIcon(icon)
        ;(marker as any)._rr_iconHtml = html
    }
    const displayName = tooltipText || getDisplayName(player)
    // Stash the latest base text so the focus overlay can enrich from it; only
    // write the live tooltip for non-focused markers (the focus overlay owns the
    // focused one and avoids per-frame open/close churn).
    ;(marker as any)._rr_baseTooltip = displayName
    if (!isFocused) {
        marker.setTooltipContent(displayName)
    }
}
import '../modules/leaflet-heat.js'
import './Map.css'

function getCRS(mapData) {
    let scaleX = 1;
    let scaleY = 1;
    let marginX = 0;
    let marginY = 0;
    if (mapData) {    
        if (mapData.transform) {
            scaleX = mapData.transform[0];
            scaleY = mapData.transform[2] * -1;
            marginX = mapData.transform[1];
            marginY = mapData.transform[3];
        }
    }
    return L.extend({}, L.CRS.Simple, {
        transformation: new L.Transformation(scaleX, marginX, scaleY, marginY),
        projection: L.extend({}, L.Projection.LonLat, {
            project: latLng => {
                return L.Projection.LonLat.project(applyRotation(latLng, mapData.coordinateRotation));
            },
            unproject: point => {
                return applyRotation(L.Projection.LonLat.unproject(point), mapData.coordinateRotation * -1);
            },
        }),
    });
}

function applyRotation(latLng, rotation) {
    if (!latLng && !latLng.lng && !latLng.lat) {
        return L.latLng(0, 0);
    }
    if (!rotation) {
        return latLng;
    }

    const angleInRadians = (rotation * Math.PI) / 180;
    const cosAngle = Math.cos(angleInRadians);
    const sinAngle = Math.sin(angleInRadians);

    const {lng: x, lat: y} = latLng;
    const rotatedX = x * cosAngle - y * sinAngle;
    const rotatedY = x * sinAngle + y * cosAngle;
    return L.latLng(rotatedY, rotatedX);
}

function getScaledBounds(bounds, scaleFactor) {
    // Calculate the center point of the bounds
    const centerX = (bounds[0][0] + bounds[1][0]) / 2;
    const centerY = (bounds[0][1] + bounds[1][1]) / 2;
    
    // Calculate the new width and height
    const width = bounds[1][0] - bounds[0][0];
    const height = bounds[1][1] - bounds[0][1];
    const newWidth = width * scaleFactor;
    const newHeight = height * scaleFactor;
    
    // Update the coordinates of the two points defining the bounds
    const newBounds = [
        [centerY - newHeight / 2, centerX - newWidth / 2],
        [centerY + newHeight / 2, centerX + newWidth / 2]
    ];

    // console.log("Initial Rectangle:", bounds);
    // console.log("Scaled Rectangle:", newBounds);
    // console.log("Center:", L.bounds(bounds).getCenter(true));
    
    return newBounds;
}

function getBounds(bounds) {
    if (!bounds) {
        return undefined;
    }
    return L.latLngBounds([bounds[0][1], bounds[0][0]], [bounds[1][1], bounds[1][0]]);
    //return [[bounds[0][1], bounds[0][0]], [bounds[1][1], bounds[1][0]]];
}

function calculateProportionalRadius(mapBounds, zoomLevel) {
    const baseRadius = 2;
    const [maxLon, minLat] = mapBounds[0];
    const [minLon, maxLat] = mapBounds[1];
    
    const width = maxLon - minLon;
    const height = maxLat - minLat;

    const referenceWidth = 145.5;
    const scalingFactor = width / referenceWidth;
    
    const zoomAdjustment = Math.pow(2, zoomLevel - 1);

    return baseRadius * scalingFactor / zoomAdjustment;
}
  

export default function MapComponent({ raidData, raidId, positions, intl_dir }) {
    const navigate = useNavigate()
    const [searchParams] = useSearchParams()
    const [currentMap, setCurrentMap] = useState('')

    // Map
    const [mapIsReady, setMapIsReady] = useState(false);
    const [heatmapEnabled, setHeatmapEnabled] = useState(false)
    const [heatmapData, setHeatmapData] = useState([])
    const [availableLayers, setAvailableLayers] = useState([])
    const [availableStyles, serAvailableStyles] = useState([])
    const [selectedStyle, setSelectedStyle] = useState('svg')
    const [selectedLayer, setSelectedLayer] = useState('')
    const [followPlayer, setFollowPlayer] = useState(null)
    const [followPlayerZoomed, setFollowPlayerZoomed] = useState(false)
    const [calculatedPlayerInfo, setCalculatedPlayerInfo] = useState({})
    const [calculatedLayerInfo, setCalculatedLayerInfo] = useState({})
    const [playerFocus, setPlayerFocus] = useState<string | null>(null)
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set(['SCAV']))
    const [proportionalScale, setProportionalScale] = useState(0)
    const [MAP, SET_MAP] = useState(null)
    const [mapHeight, setMapHeight] = useState(600)

    // Player
    const [playing, setPlaying] = useState(false)
    const [playbackSpeed, setPlaybackSpeed] = useState(1)
    const [timeCurrentIndex, setTimeCurrentIndex] = useState(0)
    const [timeStartLimit, setTimeStartLimit] = useState(0)
    const [timeEndLimit, setTimeEndLimit] = useState(0)
    const [dropOffIndex, setDropOffIndex] = useState(200)
    const [sliderTimes, setSliderTimes] = useState([])
    const [hideSettings, setHideSettings] = useState(true)
    const [hidePlayers, setHidePlayers] = useState(false)
    const [showBehavior, setShowBehavior] = useState(!!raidData?.detectedMods?.match(/SAIN/gi))
    const [hideEvents, setHideEvents] = useState(false)
    const [hideBallistics, setHideBallistics] = useState(false)
    const [hideNerdStats, setHideNerdStats] = useState(true)
    const [preserveHistory, setPreserveHistory] = useState(false)

    // Loose Loot
    const [showLooseLoot, setShowLooseLoot] = useState(true)
    const [looseLootMinPrice, setLooseLootMinPrice] = useState<number>(() => {
        const saved = localStorage.getItem('rr_looseLoot_minPrice')
        return saved ? Number(saved) : 50000
    })
    const [looseLootFilter, setLooseLootFilter] = useState<'all' | 'ground' | 'container'>(() => {
        const saved = localStorage.getItem('rr_looseLoot_filter')
        return (saved === 'ground' || saved === 'container') ? saved : 'all'
    })
    const [looseLootData, setLooseLootData] = useState<TrackingLooseLootItem[]>([])
    const [looseLootCollapsed, setLooseLootCollapsed] = useState(true)
    const looseLootLayerRef = useRef<L.LayerGroup | null>(null)
    const looseLootHighlightRef = useRef<L.CircleMarker | null>(null)

    // Bot Quests (QuestingBots integration)
    const [showBotQuests, setShowBotQuests] = useState(() => localStorage.getItem('rr_showBotQuests') !== 'false')
    const [botQuestData, setBotQuestData] = useState<any[]>([])
    const [botQuestCollapsed, setBotQuestCollapsed] = useState(true)
    const botQuestLayerRef = useRef<L.LayerGroup | null>(null)

    // Bot Objectives (Phobos integration)
    const [showBotObjectives, setShowBotObjectives] = useState(() => localStorage.getItem('rr_showBotObjectives') !== 'false')
    const [botObjectiveData, setBotObjectiveData] = useState<any[]>([])
    const [botObjectiveCollapsed, setBotObjectiveCollapsed] = useState(true)
    const botObjectiveLayerRef = useRef<L.LayerGroup | null>(null)

    // Phobos advection field
    const [showPhobosField, setShowPhobosField] = useState(() => localStorage.getItem('rr_showPhobosField') === 'true')
    const [showPhobosAdvection, setShowPhobosAdvection] = useState(() => localStorage.getItem('rr_showPhobosAdvection') !== 'false')
    // Convergence is a Phobos v1 concept (player-attraction field).
    // ORBIT dropped it. The toggle below is only surfaced when at
    // least one snapshot actually carries non-empty convergence data
    // (i.e. the raid was recorded with legacy upstream Phobos).
    const [showPhobosConvergence, setShowPhobosConvergence] = useState(() => localStorage.getItem('rr_showPhobosConvergence') !== 'false')
    const [showPhobosZones, setShowPhobosZones] = useState(() => localStorage.getItem('rr_showPhobosZones') !== 'false')
    const [phobosFieldData, setPhobosFieldData] = useState<any[]>([])
    const [phobosFieldCollapsed, setPhobosFieldCollapsed] = useState(true)
    const phobosFieldLayerRef = useRef<L.LayerGroup | null>(null)

    // Per-main marker refs aligned with the squad-mains sidebar list,
    // populated by the markers-render effect. The sidebar rows call
    // openTooltip / closeTooltip on these to highlight the matching
    // marker on the map when the user hovers a row.
    const orbitMainObjectiveMarkersRef = useRef<L.CircleMarker[]>([])

    // Phobos main objectives (ORBIT-only) — debug overlay. Per-squad
    // list of 1-5 long-term goals (Kills / LootValue / Quest), rendered
    // as numbered colour-coded markers when the user clicks a bot to
    // select that squad. Click again on any bot → hide.
    const [orbitMainObjectivesData, setOrbitMainObjectivesData] = useState<any[]>([])
    const [selectedSquadForMains, setSelectedSquadForMains] = useState<number | null>(null)
    const orbitMainObjectivesLayerRef = useRef<L.LayerGroup | null>(null)

    // Mirror the snapshot array into a ref so the click handler (bound
    // once inside the position-renderer effect, which does NOT depend on
    // this data) reads the freshest value rather than a stale closure
    // from the render where the array was still empty.
    const orbitMainObjectivesDataRef = useRef<any[]>([])
    useEffect(() => { orbitMainObjectivesDataRef.current = orbitMainObjectivesData }, [orbitMainObjectivesData])

    // Squad membership is captured per snapshot (~30s). Two failure
    // modes the naive `latest snapshot ≤ cursor` lookup handles badly:
    //   1. Early raid (first ~30s): no snapshot exists at all because
    //      SAIN brains haven't applied yet, so no squad has mains.
    //   2. Dead bot / disbanded squad late in raid: the squad drops out
    //      of all snapshots after the last member dies.
    // Both helpers scan all snapshots — findSquadIdForPlayer ignores the
    // cursor entirely (a bot's squad identity doesn't depend on cursor
    // position), findLatestSquadEntry prefers ≤ cursor for an accurate
    // completion-state render but falls back to any-time so the sidebar
    // shows something useful instead of going blank.
    const findSquadIdForPlayer = (playerId: string): number | null => {
        const data = orbitMainObjectivesDataRef.current
        for (let i = data.length - 1; i >= 0; i--) {
            const snap = data[i]
            const entry = (snap.squads || []).find((s: any) =>
                s.memberProfileIds && s.memberProfileIds.includes(playerId))
            if (entry) return Number(entry.squadId)
        }
        return null
    }
    const findLatestSquadEntry = (squadId: number, atTime: number): any => {
        const data = orbitMainObjectivesDataRef.current
        let best: any = null
        let bestTime = -Infinity
        for (const snap of data) {
            if (snap.time > atTime) continue
            const entry = (snap.squads || []).find((s: any) => Number(s.squadId) === squadId)
            if (entry && snap.time > bestTime) { best = entry; bestTime = snap.time }
        }
        if (best) return best
        // No snapshot ≤ cursor contains this squad. Most common cause:
        // cursor sits in the first ~30s before SAIN has applied brains
        // and any mains exist. Fall back to the EARLIEST future snapshot
        // (first known state) — otherwise picking the latest would
        // pre-spoil every main as 'completed' before the squad has even
        // had a chance to start them.
        let earliestFuture: any = null
        let earliestTime = Infinity
        for (const snap of data) {
            if (snap.time <= atTime) continue
            const entry = (snap.squads || []).find((s: any) => Number(s.squadId) === squadId)
            if (entry && snap.time < earliestTime) { earliestFuture = entry; earliestTime = snap.time }
        }
        return earliestFuture
    }
    // SPT quest name lookup (zoneId → friendly title). Fetched once per
    // app load. Used to resolve user-facing names on Phobos Quest POI
    // tooltips + main objectives sidebar list (trigger IDs like
    // "expl_zone_vremyan_case" are not human-friendly).
    const [questNameMap, setQuestNameMap] = useState<Record<string, string>>({})

    // Animations section
    const [animationsCollapsed, setAnimationsCollapsed] = useState(true)
    const [showHitFlash, setShowHitFlash] = useState(() => localStorage.getItem('rr_showHitFlash') !== 'false')
    const hitFlashTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())
    const prevTimeHitRef = useRef<number>(0)

    // Loot float animations
    const [showLootFloats, setShowLootFloats] = useState(() => localStorage.getItem('rr_showLootFloats') !== 'false')
    const prevTimeEndLimitRef = useRef<number>(0)

    // Bot Inventory
    const [botInvCollapsed, setBotInvCollapsed] = useState(true)
    const [selectedBotProfileId, setSelectedBotProfileId] = useState<string>('')
    const [collapsedSlots, setCollapsedSlots] = useState<Record<string, boolean>>({})
    const toggleSlotCollapse = (slot: string) => setCollapsedSlots(prev => ({ ...prev, [slot]: !prev[slot] }))

    const highlightLooseLootItem = useCallback((item: TrackingLooseLootItem | null) => {
        if (looseLootHighlightRef.current && MAP) {
            MAP.removeLayer(looseLootHighlightRef.current)
            looseLootHighlightRef.current = null
        }
        if (!item || !MAP) return
        const tp = item.price * item.qty
        const color = getLootPriceColor(tp)
        const isC = item.inContainer === true || item.inContainer === 1
        const ring = L.circleMarker([item.z, item.x], {
            radius: 14,
            color: '#fff',
            weight: 2,
            fillColor: color,
            fillOpacity: 0.4,
            interactive: false,
        })
        ring.bindTooltip(
            `<span style="color:${color}">${isC ? '\u25A0' : '\u25C6'}</span> ${item.itemName}${item.qty > 1 ? ' x' + item.qty : ''} \u2014 \u20BD${tp.toLocaleString()}`,
            { direction: 'top', offset: [0, -14], className: 'player-tooltip player-tooltip-html', permanent: true }
        )
        ring.addTo(MAP)
        ring.openTooltip()
        looseLootHighlightRef.current = ring
    }, [MAP])

    // Events
    const [events, setEvents] = useState([])

    // Pre-compute PMC index within each team group (for numbered markers in legend + map)
    const pmcIndexMap = useMemo(() => buildPmcIndexMap(raidData.players), [raidData.players])

    const focusItem = useRef(searchParams.get('q') ? searchParams.get('q').split(',') : [])
    const focusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const playerFocusRef = useRef<string | null>(null)
    const focusVictimIdsRef = useRef<Set<string>>(new Set())
    const focusKillerIdRef = useRef<string | null>(null)
    const focusLayersRef = useRef<L.Layer[]>([])
    // Persistent player-dot markers keyed by playerId, mutated in place across
    // playback frames instead of being torn down + rebuilt every tick. Fixes the
    // tooltip flicker + name jitter reported in issue #24.
    const playerMarkersRef = useRef<Map<string, L.Marker>>(new Map())
    // The focus-overlay tooltip currently applied {id, html}, so we only re-issue
    // setTooltipContent/openTooltip when it actually changes (no per-frame churn).
    const focusTooltipRef = useRef<{ id: string, html: string } | null>(null)
    // Signature of the focus kill-visualization (focus + kill-set) so the skull
    // markers / kill lines are only rebuilt on real changes, not every frame.
    const killVizSigRef = useRef<string | null>(null)
    const mapViewRef = useRef({})

    // Kill relationship sets for legend highlighting + refs for position renderer
    const { focusVictimIds, focusKillerId } = useMemo(() => {
        const victimIds = new Set<string>()
        let killerId: string | null = null
        if (playerFocus && raidData?.kills) {
            for (const e of raidData.kills) {
                if (e.time >= timeEndLimit) continue
                if (e.profileId === playerFocus && e.profileId !== e.killedId) {
                    victimIds.add(e.killedId)
                }
                if (e.killedId === playerFocus) {
                    killerId = e.profileId
                }
            }
        }
        focusVictimIdsRef.current = victimIds
        focusKillerIdRef.current = killerId
        return { focusVictimIds: victimIds, focusKillerId: killerId }
    }, [playerFocus, raidData?.kills, timeEndLimit])

    const ref = useRef()
    const mapRef = useRef(null)

    const onMapContainerRefChange = useCallback(
        (node) => {
            if (node) {
                node.style.height = `${mapHeight}px`
            }
        },
        [mapHeight]
    )

    let allMaps = useMapImages()

    const mapData = useMemo(() => {
        const map = allMaps[currentMap]

        if (map) {
            let newAvailableLayers = (map.layers || []).map((x) => ({ name: x.name, value: x.name }))
            setAvailableLayers([{ name: 'Base', value: '' }, ...newAvailableLayers])

            let newAvailableStyles = [!map.tilePath || { name: 'Satellite', value: 'tile' }, !map.svgPath || { name: 'Map', value: 'svg' }].filter((f) => f)
            serAvailableStyles(newAvailableStyles)

            // Auto-select first available style if current style isn't available
            setSelectedStyle(prev => {
                const hasStyle = newAvailableStyles.some((s) => s.value === prev)
                return hasStyle ? prev : (newAvailableStyles[0]?.value || prev)
            })
        }

        return map
    }, [allMaps, currentMap])

    /**
     * Removes the scroll bar when in the map view mode
     */
    useEffect(() => {
        if (window.location.pathname.includes('map')) {
            document.querySelector('body').style = 'overflow: hidden;'
        }

        return () => {
            document.querySelector('body').style = 'overflow: auto;'
        }
    }, [])

    /**
     * Sets the location for the map based on the raidData location value
     */
    useEffect(() => {
        const locations = {
            bigmap: 'customs',
            Sandbox: 'ground-zero',
            Sandbox_high: 'ground-zero',
            develop: 'ground-zero',
            factory4_day: 'factory',
            factory4_night: 'factory',
            hideout: 'hideout',
            Interchange: 'interchange',
            laboratory: 'the-lab',
            Lighthouse: 'lighthouse',
            privatearea: 'private-area',
            RezervBase: 'reserve',
            Shoreline: 'shoreline',
            suburbs: 'suburbs',
            TarkovStreets: 'streets-of-tarkov',
            terminal: 'terminal',
            town: 'town',
            woods: 'woods',
            Woods: 'woods',
            Labyrinth: 'the-labyrinth',
            base: 'base',
        }

        setCurrentMap(locations[raidData.location])

        const newEvents = []
        if (raidData && raidData.players) {
            for (let i = 0; i < raidData.kills.length; i++) {
                const kill = raidData.kills[i]

                const profileNickname = raidData.players.find((p) => p.profileId === kill.profileId)
                const killedNickname = raidData.players.find((p) => p.profileId === kill.killedId)

                newEvents.push({
                    time: kill.time,
                    profileId: kill.profileId,
                    profileNickname: profileNickname ? intl(profileNickname.name, intl_dir) : 'Unknown',
                    killedId: kill.killedId,
                    killedNickname: killedNickname ? intl(killedNickname.name, intl_dir) : 'Unknown',
                    weapon: kill.weapon,
                    distance: Number(kill.distance),
                    bodyPart: kill.bodyPart,
                    source: JSON.parse(kill.positionKiller),
                    target: JSON.parse(kill.positionKilled),
                })
            }
        }

        setEvents(newEvents)
    }, [raidData])

    /**
     * Resets the leaflet transform using the values of the current map data
     */
    useEffect(() => {
        ref?.current?.resetTransform()
    }, [currentMap])

    /**
     * Renders all the related data for the map
     */
    useEffect(() => {
        if (!mapData || mapData.projection !== 'interactive') {
            return
        }

        let mapCenter = [0, 0]
        let mapZoom = mapData.minZoom + 1
        let mapViewRestored = false
        const maxZoom = Math.max(7, mapData.maxZoom)

        if (mapRef.current?._leaflet_id) {
            if (mapRef.current.options.id === mapData.id) {
                if (mapViewRef.current.center) {
                    mapCenter = [mapViewRef.current.center.lat, mapViewRef.current.center.lng]
                    mapViewRestored = true
                }
                if (typeof mapViewRef.current.zoom !== 'undefined') {
                    mapZoom = mapViewRef.current.zoom
                    mapViewRestored = true
                }
            } else {
                mapViewRef.current.center = undefined
                mapViewRef.current.zoom = undefined
                mapViewRef.current.layer = undefined
            }
            mapRef.current.remove()
        }

        const map = L.map('leaflet-map', {
            maxBounds: getScaledBounds(mapData.bounds, 1.5),
            center: mapCenter,
            zoom: mapZoom,
            minZoom: mapData.minZoom,
            maxZoom: maxZoom,
            zoomSnap: 0.1,
            scrollWheelZoom: true,
            wheelPxPerZoomLevel: 120,
            crs: getCRS(mapData),
            attributionControl: false,
            id: mapData.id,
            preferCanvas: true,
        })

        const zoomLevel = map.getZoom()
        setProportionalScale(calculateProportionalRadius(mapData.bounds, zoomLevel))

        const updateProportionalScale = () => {
            const zoomLevel = map.getZoom()
            const newProportionalScale = calculateProportionalRadius(mapData.bounds, zoomLevel)
            setProportionalScale(newProportionalScale)
        }

        map.on('zoom', () => {
            mapViewRef.current.zoom = map.getZoom()
            updateProportionalScale()
        })

        map.on('move', () => {
            mapViewRef.current.center = map.getCenter()
        })

        const bounds = getBounds(mapData.bounds)
        const baseLayerOptions = {
            maxZoom: maxZoom,
            maxNativeZoom: mapData.maxZoom,
            extents: [
                {
                    height: mapData.heightRange || [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
                    bounds: [mapData.bounds],
                },
            ],
            type: 'map-layer',
        }

        const tileSize = mapData.tileSize || 256

        // Create separate layer groups for base layers and overlay layers
        const baseLayerGroup = L.layerGroup().addTo(map)
        const overlayLayerGroup = L.layerGroup().addTo(map)

        // Add base layers
        if (mapData.tilePath && selectedStyle === 'tile') {
            const tileLayer = L.tileLayer(mapData.tilePath, {
                tileSize,
                bounds,
                ...baseLayerOptions,
            })
            baseLayerGroup.addLayer(tileLayer)
        }

        if (mapData.svgPath && selectedStyle === 'svg') {
            const svgBounds = mapData.svgBounds ? getBounds(mapData.svgBounds) : bounds
            const svgLayer = L.imageOverlay(mapData.svgPath, svgBounds, baseLayerOptions)
            baseLayerGroup.addLayer(svgLayer)
        }

        // Add overlay layers
        if (mapData.layers) {
            for (let i = 0; i < mapData.layers.length; i++) {
                const layer = mapData.layers[i]
                const layerOptions = {
                    ...baseLayerOptions,
                    name: layer.name,
                    extents: layer.extents || baseLayerOptions.extents,
                    type: 'map-layer',
                    overlay: Boolean(layer.extents),
                }

                if (layer.tilePath && selectedStyle === 'tile') {
                    const tileLayer = L.tileLayer(layer.tilePath, {
                        tileSize,
                        bounds,
                        ...layerOptions,
                    })
                    overlayLayerGroup.addLayer(tileLayer)
                }

                if (layer.svgPath && selectedStyle === 'svg') {
                    const svgBounds = layer.svgBounds ? getBounds(layer.svgBounds) : bounds
                    const svgLayer = L.imageOverlay(layer.svgPath, svgBounds, layerOptions)
                    overlayLayerGroup.addLayer(svgLayer)
                }
            }
        }
        // Set initial visibility based on selectedLayer
        if (selectedLayer === '') {
            baseLayerGroup.addTo(map)
        } else {
            overlayLayerGroup.addTo(map)
        }

        // Function to handle layer visibility and opacity based on selectedLayer
        const toggleLayers = () => {
            // Set opacity for base layers
            baseLayerGroup.eachLayer((layer) => {
                if (selectedLayer === '') {
                    layer.setOpacity(1) // Active layer
                } else {
                    layer.setOpacity(0.3) // Inactive layers
                }
            })

            // Set opacity for overlay layers
            overlayLayerGroup.eachLayer((layer) => {
                if (selectedLayer === layer.options.name) {
                    layer.setOpacity(1) // Active layer
                } else {
                    layer.setOpacity(0) // Inactive layers
                }
            })
        }

        // Toggle layers when selectedLayer changes
        toggleLayers()

        if (map && !mapViewRestored) {
            map.setView(L.latLngBounds(bounds).getCenter(true), undefined, { animate: false })
        }

        mapRef.current = map
        SET_MAP(map);
        setTimeout(() => {
            setMapIsReady(true)
        }, 500)

        if (heatmapEnabled) {
            L.heatLayer(heatmapData, { radius: 10, max: 1, blur: 10 }).addTo(map)
        }
        
    }, [mapData, mapRef, mapViewRef, selectedLayer, selectedStyle, heatmapEnabled, heatmapData])

    // Heatmap Fetcher
    useEffect(() => {
        if (!mapIsReady) return;

        (async () => {
            if (heatmapData.length === 0) {
                const data = await api.getRaidHeatmapData(raidId)
                if (data) {
                    setHeatmapData(data)
                }
            }
        })()

        var overlayParent = document.querySelector('.map-container')
        if (overlayParent === undefined) return
        if (heatmapEnabled) {
            overlayParent?.classList.add('heatmap-active')
        } else {
            overlayParent?.classList.remove('heatmap-active')
        }
    }, [mapIsReady, heatmapEnabled])

    // Positon Renderer
    useEffect(() => {
        if (!mapIsReady) return;

        let times = []

        clearMap(MAP, { start: timeStartLimit, end: timeEndLimit })

        // Issue #24: player markers are persistent and mutated in place (see
        // playerMarkersRef); track which players we render this frame so we can
        // cull markers for players who died or scrubbed out of the time window.
        // Dots live in Leaflet's markerPane, which sits above the overlayPane the
        // per-frame polylines are re-added to, so they always stay on top.
        const renderedPlayerIds = new Set<string>()

        const playerPositionKeys = Object.keys(positions)
        for (let i = 0; i < playerPositionKeys.length; i++) {
            if (MAP === undefined) continue

            const playerId = playerPositionKeys[i]
            const playerPositions = positions[playerId]
            const cleanPositions = []
            let currentDirection = 0

            const isPlayerDead = events.find((e) => e.killedId === playerId && e.time < timeEndLimit)

            if (playerPositions === undefined) continue
            for (let j = 0; j < playerPositions.length; j++) {
                const playerPosition = playerPositions[j]
                if (playerPosition === undefined) continue
                times.push(playerPosition.time)

                if (timeEndLimit && timeStartLimit) {
                    if (playerPosition.time > (!isPlayerDead ? timeStartLimit : timeEndLimit * -1000) && playerPosition.time < timeEndLimit) {
                        cleanPositions.push([playerPosition.z, playerPosition.x])
                    }
                }

                if (playerPositions.length - 1 === j) {
                    currentDirection = playerPosition.dir
                }
            }

            const index = calculatedPlayerInfo[playerId]?.index || raidData.players.findIndex((p) => p.profileId === playerId)
            const player = calculatedPlayerInfo[playerId]?.player || raidData.players[index]
            const pickedColor = calculatedPlayerInfo[playerId]?.pickedColor || getPlayerColor(player, index)
            if (calculatedPlayerInfo[playerId] === undefined) {
                let newAddition = { ...calculatedPlayerInfo }
                newAddition[playerId] = { player, index, pickedColor }
                setCalculatedPlayerInfo(newAddition)
            }

            // Hide player movement if enabled
            if (MAP && !hidePlayers && cleanPositions.length > 0) {
                let endOfLine = cleanPositions[cleanPositions.length - 1]

                // Determine opacity based on current focus (read from refs to avoid re-render dependency)
                const currentFocus = playerFocusRef.current
                const currentVictimIds = focusVictimIdsRef.current
                const currentKillerId = focusKillerIdRef.current
                let polylineOpacity: number
                let markerOpacity: number
                if (currentFocus !== null) {
                    if (currentFocus === playerId) {
                        polylineOpacity = 1
                        markerOpacity = 1
                    } else if (currentVictimIds.has(playerId)) {
                        // Victim of focused player: hide trail (dead, no dot rendered)
                        polylineOpacity = 0
                        markerOpacity = 0
                    } else if (currentKillerId && currentKillerId === playerId) {
                        // Killer of focused player: keep visible
                        polylineOpacity = 0.6
                        markerOpacity = 0.8
                    } else {
                        polylineOpacity = isPlayerDead ? 0 : 0.1
                        markerOpacity = isPlayerDead ? 0 : 0.1
                    }
                } else {
                    polylineOpacity = preserveHistory ? 0.8 : isPlayerDead ? 0 : 0.8
                    markerOpacity = isPlayerDead ? 0 : 1
                }

                if (!MAP) return
                const pl = L.polyline(cleanPositions, { color: pickedColor, weight: 4, opacity: polylineOpacity })
                    .addTo(MAP)
                    .on('click', () => {
                        setFollowPlayer(playerId)
                        setFollowPlayerZoomed(false)
                    })
                pl._rr_playerId = playerId
                pl._rr_isDead = !!isPlayerDead
                pl._rr_normalOpacity = preserveHistory ? 0.8 : isPlayerDead ? 0 : 0.8

                if (!isPlayerDead) {
                    // Get latest behavior decision + health from position data (skip BTR)
                    const isBTR = player?.type?.includes('BTR')
                    let currentDecision: string | undefined
                    let currentHealth: number | undefined
                    let maxHealth: number | undefined
                    let behaviorCat = null
                    let behaviorLine = ''
                    let healthLine = ''
                    const pp = positions[playerId]
                    if (pp) {
                        for (let di = pp.length - 1; di >= 0; di--) {
                            if (pp[di].time <= timeEndLimit) {
                                currentDecision = pp[di].decision
                                currentHealth = pp[di].health
                                maxHealth = pp[di].maxHealth
                                break
                            }
                        }
                    }
                    if (showBehavior && !isBTR) {
                        behaviorCat = getBehaviorCategory(currentDecision)
                        behaviorLine = `<br/><span style="color:${behaviorCat.color}">${behaviorCat.label}</span>${currentDecision ? ': ' + formatDecisionLabel(currentDecision) : ''}`
                    }
                    if (currentHealth != null && maxHealth != null && maxHealth > 0) {
                        const pct = Math.round((currentHealth / maxHealth) * 100)
                        const hpColor = pct > 60 ? '#22C55E' : pct > 30 ? '#F59E0B' : '#EF4444'
                        healthLine = `<br/><span style="color:${hpColor}">\u2764 ${Math.round(currentHealth)}/${Math.round(maxHealth)} (${pct}%)</span>`
                    }
                    // Build loot summary for this player up to current time
                    let lootLine = ''
                    if (raidData?.looting) {
                        const playerLoot = raidData.looting.filter(l => {
                            const added = l.added === 'True' || l.added === 'true' || l.added === '1'
                            return l.profileId === playerId && added && Number(l.time) <= timeEndLimit
                        })
                        if (playerLoot.length > 0) {
                            const totalValue = playerLoot.reduce((sum, l) => sum + (l.price || 0) * Number(l.qty || 1), 0)
                            const top3 = [...playerLoot].sort((a, b) => (b.price || 0) * Number(b.qty || 1) - (a.price || 0) * Number(a.qty || 1)).slice(0, 3)
                            const itemList = top3.map(l => {
                                const p = (l.price || 0) * Number(l.qty || 1)
                                return `${l.itemName || l.name}${p > 0 ? ' \u20BD' + p.toLocaleString() : ''}`
                            }).join(', ')
                            lootLine = `<br/><span style="color:#FACC15">\u{1F4E6} ${playerLoot.length} items</span> (\u20BD${totalValue.toLocaleString()})<br/><span style="font-size:10px;opacity:0.7">${itemList}${playerLoot.length > 3 ? '...' : ''}</span>`
                        }
                    }
                    // Extract objective hint: when the bot's latest
                    // Phobos objective is an Exfil POI, surface the
                    // squad-wide ExtractRequested reason (loot ≥ Xk₽,
                    // all mains done, raid time low) so the user can
                    // see WHY the bot is extracting, not just where.
                    let extractLine = ''
                    if (botObjectiveData && botObjectiveData.length > 0) {
                        let latestObj: any = null
                        for (const o of botObjectiveData) {
                            if (o.profileId !== playerId) continue
                            const t = Number(o.time)
                            if (t > timeEndLimit) continue
                            if (!latestObj || t > Number(latestObj.time)) latestObj = o
                        }
                        if (latestObj && latestObj.category === 'Exfil') {
                            const reason = latestObj.extractReason && String(latestObj.extractReason).trim().length > 0
                                ? String(latestObj.extractReason).trim()
                                : 'extract requested'
                            extractLine = `<br/><span style="color:#60A5FA">\u{1F6AA} Extracting: ${reason}</span>`
                        }
                    }
                    const tip = `${getDisplayName(player)} (${getPlayerDifficultyAndBrain(player)})${healthLine}${behaviorLine}${extractLine}${lootLine}`
                    const ringColor = behaviorCat && behaviorCat.key !== 'idle' && behaviorCat.key !== 'patrol' ? behaviorCat.color : undefined
                    const hpPct = (currentHealth != null && maxHealth != null && maxHealth > 0) ? Math.round((currentHealth / maxHealth) * 100) : undefined
                    const isFocused = playerFocusRef.current === playerId
                    let marker = playerMarkersRef.current.get(playerId)
                    if (!marker) {
                        // First appearance: create once, wire listeners once.
                        marker = createPlayerMarker(endOfLine, pickedColor, player, proportionalScale, markerOpacity, pmcIndexMap[playerId], tip, ringColor, hpPct)
                        marker._rr_playerId = playerId
                        marker._rr_isDead = false
                        marker._rr_normalOpacity = 1
                        marker._rr_persistentPlayer = true
                        marker.addTo(MAP)
                        marker.on('mouseover', () => {
                            if (focusTimeoutRef.current) clearTimeout(focusTimeoutRef.current)
                            setPlayerFocus(playerId)
                        })
                        marker.on('mouseout', () => {
                            if (focusTimeoutRef.current) clearTimeout(focusTimeoutRef.current)
                            focusTimeoutRef.current = setTimeout(() => setPlayerFocus(null), 100)
                        })
                        // ORBIT main objectives: click any bot marker to toggle
                        // the per-squad mains overlay (see findSquadIdForPlayer).
                        marker.on('click', () => {
                            const sqId = findSquadIdForPlayer(playerId)
                            if (sqId == null) return
                            setSelectedSquadForMains(prev => prev === sqId ? null : sqId)
                        })
                        playerMarkersRef.current.set(playerId, marker)
                    } else {
                        // Subsequent frames: mutate in place — no teardown/rebind.
                        updatePlayerMarker(marker, endOfLine, pickedColor, player, proportionalScale, markerOpacity, pmcIndexMap[playerId], tip, ringColor, hpPct, isFocused)
                        marker._rr_isDead = false
                        marker._rr_normalOpacity = 1
                    }
                    renderedPlayerIds.add(playerId)
                    if (followPlayer === playerId) {
                        if (!followPlayerZoomed) {
                            MAP.setZoom(3)
                            setFollowPlayerZoomed(true)
                        }
                        // Snap (no pan animation): the bare `4` here used to take
                        // Leaflet's animated branch, restarting a 0.25s tween every
                        // frame and producing the ~1px name jitter from issue #24.
                        MAP.panTo(endOfLine, { animate: false })
                    }
                }
            }
        }

        // Cull persistent markers for players not rendered this frame — i.e. the
        // player died (isPlayerDead), was hidden (hidePlayers), or scrubbed out of
        // the time window (empty cleanPositions). The old stateless rebuild got
        // this for free via clearMap; persistent markers must reconcile it here.
        for (const [pid, marker] of playerMarkersRef.current) {
            if (!renderedPlayerIds.has(pid)) {
                try { marker.remove() } catch (e) { /* layer/map already gone */ }
                playerMarkersRef.current.delete(pid)
            }
        }

        if (sliderTimes.length === 0) {
            times = _.chain(times)
                .uniq()
                .sort((t) => t)
                .value()
            setSliderTimes(times)
            setTimeStartLimit(times[0])
            setTimeEndLimit(times[times.length - 1])
            setTimeCurrentIndex(times.length - 1)
        }
    }, [mapIsReady, mapViewRef, timeEndLimit, timeStartLimit, timeCurrentIndex, MAP, preserveHistory, events, hideEvents, hidePlayers, followPlayer, pmcIndexMap, showBehavior])

    // Focus overlay: adjusts layer opacity + kill visualization without full re-render
    useEffect(() => {
        if (!MAP || !mapIsReady) return
        playerFocusRef.current = playerFocus

        // Issue #24 follow-up: the kill-visualization layers (kill/death lines,
        // skull markers, dead-player temp marker) are static for a given focus +
        // kill-set, but this effect re-runs every playback frame (timeEndLimit is a
        // dep, needed to keep the focused tooltip's live HP/loot fresh). Only tear
        // them down + rebuild when the focus or relevant kill-set actually changes,
        // otherwise the skull icons strobe while hovering the killer during play.
        const killVizSig = playerFocus
            ? `${playerFocus}|${events.filter(e => (e.killedId === playerFocus || (e.profileId === playerFocus && e.profileId !== e.killedId)) && e.time < timeEndLimit).length}`
            : ''
        const killVizChanged = killVizSig !== killVizSigRef.current
        if (killVizChanged) {
            killVizSigRef.current = killVizSig
            // Clean up previous focus layers
            for (const layer of focusLayersRef.current) {
                MAP.removeLayer(layer)
            }
            focusLayersRef.current = []
        }

        // Build victim/killer sets for kill relationship highlighting
        const victimIds = new Set<string>()
        let killerId: string | null = null
        if (playerFocus) {
            for (const e of events) {
                if (e.time >= timeEndLimit) continue
                if (e.profileId === playerFocus && e.profileId !== e.killedId) {
                    victimIds.add(e.killedId)
                }
                if (e.killedId === playerFocus) {
                    killerId = e.profileId
                }
            }
        }

        // Adjust opacity of all tagged player layers
        for (const key in MAP._layers) {
            const layer = MAP._layers[key]
            if (!layer._rr_playerId) continue

            if (playerFocus === null) {
                // Restore normal opacity
                if (layer instanceof L.Polyline && !(layer instanceof L.Circle)) {
                    layer.setStyle({ opacity: layer._rr_normalOpacity ?? 0.8 })
                } else if (layer instanceof L.Circle) {
                    const op = layer._rr_normalOpacity ?? 1
                    layer.setStyle({ opacity: op, fillOpacity: op })
                }
                if (layer instanceof L.Marker) {
                    layer.setOpacity(layer._rr_normalOpacity ?? 1)
                }
            } else if (playerFocus === layer._rr_playerId) {
                // Full opacity for focused player
                if (layer instanceof L.Polyline && !(layer instanceof L.Circle)) {
                    layer.setStyle({ opacity: 1 })
                } else if (layer instanceof L.Circle) {
                    layer.setStyle({ opacity: 1, fillOpacity: 1 })
                }
                if (layer instanceof L.Marker) {
                    layer.setOpacity(1)
                }
            } else {
                // Determine opacity: victims hidden, killer visible, others dimmed
                const op = victimIds.has(layer._rr_playerId) ? 0
                    : (killerId && killerId === layer._rr_playerId) ? 0.7
                    : layer._rr_isDead ? 0 : 0.1
                if (layer instanceof L.Polyline && !(layer instanceof L.Circle)) {
                    layer.setStyle({ opacity: op })
                } else if (layer instanceof L.Circle) {
                    layer.setStyle({ opacity: op, fillOpacity: op })
                }
                if (layer instanceof L.Marker) {
                    layer.setOpacity(op)
                }
            }
        }

        // Issue #24: this effect re-runs every playback frame (timeEndLimit is a
        // dep), so we must NOT blindly close/reopen the focused tooltip each tick.
        // When focus moves off a marker, revert it to its base tooltip once.
        const prevFocus = focusTooltipRef.current
        if (prevFocus && prevFocus.id !== playerFocus) {
            const prevMarker = playerMarkersRef.current.get(prevFocus.id)
            if (prevMarker) {
                if (prevMarker._rr_baseTooltip !== undefined) prevMarker.setTooltipContent(prevMarker._rr_baseTooltip)
                prevMarker.closeTooltip()
            }
            focusTooltipRef.current = null
        }
        if (playerFocus) {
            const kills = events.filter(e => e.profileId === playerFocus && e.profileId !== e.killedId && e.time < timeEndLimit)
            const death = events.find(e => e.killedId === playerFocus && e.time < timeEndLimit)

            // Build killfeed HTML with icons
            const buildFeedHtml = (titleHtml: string) => {
                let html = `<strong>${titleHtml}</strong>`
                if (kills.length > 0 || death) {
                    html += '<div style="margin-top:4px;border-top:1px solid rgba(255,255,255,0.2);padding-top:4px;font-size:11px;">'
                    for (const k of kills) {
                        const victim = raidData.players.find(p => p.profileId === k.killedId)
                        const victimIdx = victim ? raidData.players.indexOf(victim) : 0
                        const victimIcon = victim ? getTooltipIconHtml(victim, getPlayerColor(victim, victimIdx), pmcIndexMap[k.killedId]) : ''
                        html += `<div>\u2620 ${victimIcon}${k.killedNickname} (${intl([k.weapon.replace('Name', 'ShortName')], intl_dir)}, ${k.distance.toFixed(0)}m${k.bodyPart ? ', ' + k.bodyPart : ''})</div>`
                    }
                    if (death) {
                        const killer = raidData.players.find(p => p.profileId === death.profileId)
                        const killerIdx = killer ? raidData.players.indexOf(killer) : 0
                        const killerIcon = killer ? getTooltipIconHtml(killer, getPlayerColor(killer, killerIdx), pmcIndexMap[death.profileId]) : ''
                        html += `<div style="color:#EF4444;">\u{1F480} ${killerIcon}${death.profileNickname} (${intl([death.weapon.replace('Name', 'ShortName')], intl_dir)}, ${death.distance.toFixed(0)}m${death.bodyPart ? ', ' + death.bodyPart : ''})</div>`
                    }
                    html += '</div>'
                }
                return html
            }

            // Alive player: enrich the persistent marker's tooltip in place. Only
            // (re)apply when the content actually changed, and call openTooltip at
            // most once — this is what removes the per-frame flicker (issue #24).
            const marker = playerMarkersRef.current.get(playerFocus)
            if (marker) {
                const base = marker._rr_baseTooltip !== undefined
                    ? marker._rr_baseTooltip
                    : (marker.getTooltip()?.getContent() ?? '')
                const html = buildFeedHtml(base as string)
                const prev = focusTooltipRef.current
                if (!prev || prev.id !== playerFocus || prev.html !== html) {
                    marker.setTooltipContent(html)
                    if (!(marker.isTooltipOpen && marker.isTooltipOpen())) marker.openTooltip()
                    focusTooltipRef.current = { id: playerFocus, html }
                }
            }

            // Dead player: no marker on map, create a temporary one at death position
            // (gated: only (re)build when the kill-set/focus changed — see killVizSig)
            if (killVizChanged && !marker && death) {
                const player = raidData.players.find(p => p.profileId === playerFocus)
                const playerIdx = player ? raidData.players.indexOf(player) : 0
                const color = player ? getPlayerColor(player, playerIdx) : '#999'
                const displayName = player ? `${getDisplayName(player)} (${getPlayerDifficultyAndBrain(player)})` : 'Unknown'
                const tmpMarker = L.circleMarker([death.target.z, death.target.x], {
                    radius: 6, color, fillColor: color, fillOpacity: 0.8, weight: 1, interactive: false
                }).addTo(MAP)
                tmpMarker.bindTooltip(buildFeedHtml(displayName), { direction: 'top', offset: [0, -10], className: 'player-tooltip' })
                tmpMarker.openTooltip()
                tmpMarker._rr_focusViz = true
                focusLayersRef.current.push(tmpMarker)
            }
        }

        // Add kill visualization if a player is focused (gated by killVizSig so the
        // skull markers / lines are not torn down + rebuilt every playback frame).
        if (killVizChanged && playerFocus && events.length > 0) {
            // Kills made by hovered player (respecting timeline)
            const playerKills = events.filter(e => e.profileId === playerFocus && e.profileId !== e.killedId && e.time < timeEndLimit)
            for (const kill of playerKills) {
                const line = L.polyline(
                    [[kill.source.z, kill.source.x], [kill.target.z, kill.target.x]],
                    { color: 'red', weight: 2, dashArray: [10], dashOffset: 3, opacity: 1, interactive: false }
                ).addTo(MAP)
                line._rr_focusViz = true
                focusLayersRef.current.push(line)
                const skullHtml = `<img src="/skull.png" /><span class="tooltiptext event event-map text-sm"><strong>${kill.killedNickname}</strong><br/>${intl([kill.weapon.replace('Name', 'ShortName')], intl_dir)}, ${kill.distance.toFixed(0)}m${kill.bodyPart ? ', ' + kill.bodyPart : ''}</span>`
                const skullIcon = L.divIcon({ className: 'death-icon tooltip event follow-kill-marker', html: skullHtml })
                const marker = L.marker([kill.target.z, kill.target.x], { icon: skullIcon, interactive: false, zIndexOffset: -1000 }).addTo(MAP)
                marker._rr_focusViz = true
                focusLayersRef.current.push(marker)
            }

            // Death of the hovered player (if dead) — distinct red-ringed skull
            const deathEvent = events.find(e => e.killedId === playerFocus && e.time < timeEndLimit)
            if (deathEvent) {
                const line = L.polyline(
                    [[deathEvent.source.z, deathEvent.source.x], [deathEvent.target.z, deathEvent.target.x]],
                    { color: 'red', weight: 2, dashArray: [10], dashOffset: 3, opacity: 1, interactive: false }
                ).addTo(MAP)
                line._rr_focusViz = true
                focusLayersRef.current.push(line)
                const ownDeathHtml = `<div class="own-death-ring"><img src="/skull.png" /></div><span class="tooltiptext event event-map text-sm"><strong>${deathEvent.profileNickname}</strong><br/>killed<br/><strong>${deathEvent.killedNickname}</strong><br/>${intl([deathEvent.weapon.replace('Name', 'ShortName')], intl_dir)}, ${deathEvent.distance.toFixed(0)}m${deathEvent.bodyPart ? ', ' + deathEvent.bodyPart : ''}</span>`
                const ownDeathIcon = L.divIcon({ className: 'death-icon tooltip event follow-kill-marker', html: ownDeathHtml })
                const marker = L.marker([deathEvent.target.z, deathEvent.target.x], { icon: ownDeathIcon, interactive: false, zIndexOffset: -1000 }).addTo(MAP)
                marker._rr_focusViz = true
                focusLayersRef.current.push(marker)
            }
        }
    }, [playerFocus, MAP, mapIsReady, events, timeEndLimit, intl_dir])

    // Issue #24: persistent player markers live across frames; when the map
    // instance is torn down/rebuilt, drop them so the ref never holds dead layers.
    useEffect(() => {
        return () => {
            playerMarkersRef.current.forEach((marker) => {
                try { marker.remove() } catch (e) { /* map already gone */ }
            })
            playerMarkersRef.current.clear()
            focusTooltipRef.current = null
            // Force the gated focus kill-viz to rebuild on the next (new) map.
            killVizSigRef.current = null
            focusLayersRef.current = []
        }
    }, [MAP])

    // Slider Time Update
    useEffect(() => {
        if (preserveHistory) {
            setTimeStartLimit(sliderTimes[0])
        } else {
            setTimeStartLimit(sliderTimes[Math.max(0, timeCurrentIndex - dropOffIndex)])
        }
    }, [sliderTimes, timeCurrentIndex, preserveHistory])

    // Event Update
    const addedLayers = useRef(new Map());
    useEffect(() => {
        if (!mapIsReady) return;

        const createdLayers = new Map();
        for (let i = 0; i < events.length; i++) {
            const e = events[i];
    
            const toBeIndex = findInsertIndex(e.time, sliderTimes);
    
            // Killer marker
            var killerIcon = L.divIcon({ className: 'killer-icon', html: `<img src="/target.png" />` });
            var killerMarker = L.marker([e.source.z, e.source.x], { icon: killerIcon });
            killerMarker.eventTime = e.time;
            killerMarker.eventType = 'killerIcon';
            killerMarker.addTo(MAP);
            createdLayers.set(`killer-${e.time}-${e.source.z}-${e.source.x}`, killerMarker);
    
            // Polyline
            var polyline = L.polyline(
                [
                    [e.source.z, e.source.x],
                    [e.target.z, e.target.x],
                ],
                { color: 'red', weight: 2, dashArray: [10], dashOffset: 3, opacity: 1 }
            );
            polyline.eventTime = e.time;
            polyline.eventType = 'killerLine';
            polyline.addTo(MAP);
            createdLayers.set(`line-${e.time}-${e.source.z}-${e.source.x}-${e.target.z}`, polyline);
    
            // Death marker
            var deathHtml = `<img src="/skull.png" /><span class="tooltiptext event event-map text-sm">${
                e.profileId === e.killedId ? `<strong>${e.profileNickname}</strong><br/>died` : `<strong>${e.profileNickname}</strong><br/>killed<br/><strong>${e.killedNickname}</strong>`
            }</span>`;
            var deathIcon = L.divIcon({ className: 'death-icon tooltip event', html: deathHtml });
            var deathMarker = L.marker([e.target.z, e.target.x], { icon: deathIcon });
            deathMarker.eventTime = e.time;
            deathMarker.eventType = 'deathIcon';
            deathMarker.addTo(MAP).on('click', () =>
                highlight(
                    [
                        [e.target.z, e.target.x],
                        [e.source.z, e.source.x],
                    ],
                    e.time
                )
            );
            createdLayers.set(`death-${e.time}-${e.target.z}-${e.target.x}`, deathMarker);
        }
    
        addedLayers.current = createdLayers;
    
        return () => {
            createdLayers.forEach((layer) => {
                MAP.removeLayer(layer);
            });
        };
    }, [MAP, events, mapIsReady]);
    
    useEffect(() => {
        const timeRange = { start: preserveHistory ? 0 : sliderTimes[timeCurrentIndex - dropOffIndex] || 0, end: sliderTimes[timeCurrentIndex] };
    
        addedLayers.current.forEach((layer, key) => {
            if (layer instanceof L.Marker) {
                const layerElement = layer.getElement();
                if (layerElement) {
                    // if (layer.eventTime > timeRange.start && layer.eventTime < timeRange.end) {
                    if (layer.eventTime > timeRange.start && layer.eventTime < timeRange.end) {
                        layerElement.classList.remove('invisible');
                    } else {
                        layerElement.classList.add('invisible');
                    }
                }
            } 
            
            else if (layer instanceof L.Polyline) {
                if (layer.eventTime > timeRange.start && layer.eventTime < timeRange.end) {
                    layer.setStyle({ opacity: 1 });
                } else {
                    layer.setStyle({ opacity: 0 });
                }
            }
        });
    }, [sliderTimes, timeCurrentIndex]);    

    // Ballistics Update (with grenade detection)
    let ballisticsLayers = new Map();
    useEffect(() => {
        if (hideBallistics) return;
        if (!mapIsReady || !MAP) return;

        // Grenade visualization: detect throws from behavior decisions, match to ballistic clusters
        // Step 1: Find grenade throw moments from position decisions
        const grenadeThrows: { profileId: string, time: number, x: number, z: number }[] = []
        const posData = positions as any
        if (posData) {
            for (const [profileId, pArr] of Object.entries(posData)) {
                if (!Array.isArray(pArr)) continue
                for (let pi = 0; pi < pArr.length; pi++) {
                    const p = pArr[pi]
                    const dec = (p.decision || '')
                    const decLower = dec.toLowerCase()
                    const isGrenadeDec = decLower.includes('throwgrenade') || decLower.includes('runandthrowgrenade') || decLower === 'sain:throwgrenade'
                    if (!isGrenadeDec) continue
                    // Only record the first tick of each throw sequence
                    if (pi > 0) {
                        const prevDec = (pArr[pi - 1].decision || '').toLowerCase()
                        const prevIsGrenade = prevDec.includes('throwgrenade') || prevDec.includes('runandthrowgrenade') || prevDec === 'sain:throwgrenade'
                        if (prevIsGrenade) continue
                    }
                    grenadeThrows.push({ profileId, time: Number(p.time), x: Number(p.x), z: Number(p.z) })
                }
            }
        }

        // Step 2: Build ballistic clusters (group by profileId + time)
        const ballisticClusters: Record<string, { src: any, time: number, count: number, weaponName: string }> = {}
        for (const b of raidData.ballistic) {
            try {
                const src = JSON.parse(b.source)
                const key = `${b.profileId}_${b.time}`
                if (!ballisticClusters[key]) {
                    ballisticClusters[key] = { src, time: b.time, count: 0, weaponName: b.weaponName || '' }
                }
                ballisticClusters[key].count++
            } catch {}
        }

        // Step 3: Match throws to explosion clusters (same bot, within 10s, 3+ fragments, source far from bot)
        const grenadeExplosions: { throwTime: number, throwX: number, throwZ: number, explosionX: number, explosionZ: number, explosionTime: number, profileId: string, weaponName: string }[] = []
        for (const gt of grenadeThrows) {
            let bestKey = ''
            let bestDt = Infinity
            for (const [key, cluster] of Object.entries(ballisticClusters)) {
                if (!key.startsWith(gt.profileId + '_')) continue
                if (cluster.count < 3) continue
                const dt = cluster.time - gt.time
                if (dt < 0 || dt > 10000) continue
                // Explosion source must be far from the bot's throw position (> 5m)
                // If source is near the bot, it's regular gunfire, not a grenade landing
                const dx = cluster.src.x - gt.x
                const dz = cluster.src.z - gt.z
                const distSq = dx * dx + dz * dz
                if (distSq < 25) continue // 5m minimum distance
                if (dt < bestDt) { bestDt = dt; bestKey = key }
            }
            if (bestKey) {
                const cluster = ballisticClusters[bestKey]
                grenadeExplosions.push({
                    throwTime: gt.time, throwX: gt.x, throwZ: gt.z,
                    explosionX: cluster.src.x, explosionZ: cluster.src.z,
                    explosionTime: cluster.time, profileId: gt.profileId,
                    weaponName: cluster.weaponName
                })
            }
        }

        // Clean up expired grenade layers
        if (MAP) {
            for (const key in MAP._layers) {
                const layer = MAP._layers[key]
                if (!layer._rr_grenade) continue
                if (!layer.eventTime) continue
                const idx = findInsertIndex(layer.eventTime, sliderTimes)
                if (idx + 40 < timeCurrentIndex || idx > timeCurrentIndex) {
                    MAP.removeLayer(layer)
                    if (layer.eventId) ballisticsLayers.delete(layer.eventId)
                }
            }
        }

        // Render grenade arcs + explosion circles (alongside normal ballistics, not replacing them)
        for (const ge of grenadeExplosions) {
            const throwIndex = findInsertIndex(ge.throwTime, sliderTimes)
            const explosionIndex = findInsertIndex(ge.explosionTime, sliderTimes)
            if (throwIndex > timeCurrentIndex || explosionIndex + 40 < timeCurrentIndex) continue

            const grenadeId = `grenade-${ge.profileId}-${ge.throwTime}`
            if (ballisticsLayers.get(grenadeId)) continue

            // Explosion circle
            const explosionCircle = L.circle([ge.explosionZ, ge.explosionX], {
                radius: 3, color: '#FF6B35', weight: 2,
                fillColor: '#FF6B35', fillOpacity: 0.2, dashArray: '3 3',
            })
            explosionCircle.eventTime = ge.explosionTime
            explosionCircle.eventType = 'ballisticsLine'
            explosionCircle.eventId = grenadeId
            const player = raidData?.players?.find(p => p.profileId === ge.profileId)
            const throwerName = player?.name || ge.profileId.slice(0, 8)
            explosionCircle.bindTooltip(
                `\u{1F4A5} <strong>${throwerName}</strong> — ${ge.weaponName || 'Grenade'}`,
                { direction: 'top', offset: [0, -8], className: 'player-tooltip player-tooltip-html' }
            )
            explosionCircle._rr_grenade = true
            explosionCircle.addTo(MAP)

            // Arc from throw position to explosion
            const arcLine = L.polyline(
                [[ge.throwZ, ge.throwX], [ge.explosionZ, ge.explosionX]],
                { color: '#FF6B35', weight: 2.5, dashArray: '6 4', opacity: 0.8 }
            )
            arcLine.eventTime = ge.throwTime
            arcLine.eventType = 'ballisticsLine'
            arcLine.eventId = grenadeId + '_arc'
            arcLine._rr_grenade = true
            arcLine.addTo(MAP)

            ballisticsLayers.set(grenadeId, true)
            ballisticsLayers.set(grenadeId + '_arc', true)
        }

        // Render normal ballistics (all, including grenade fragments)
        const createdLayers = new Map();
        for (let i = 0; i < raidData.ballistic.length; i++) {
            const ballistic = raidData.ballistic[i];
            const toBeIndex = findInsertIndex(ballistic.time, sliderTimes);

            let passedTime = toBeIndex < timeCurrentIndex;
            let expiredTime = toBeIndex + 40 > timeCurrentIndex;
            if (passedTime && expiredTime) {
                let source = JSON.parse(ballistic.source);
                let target = JSON.parse(ballistic.target);

                let ballisticsId = `${i}-${ballistic.time}-${source.z}-${source.x}-${target.z}-${target.x}`;
                let exists = ballisticsLayers.get(ballisticsId);

                if (!exists && (target && source)) {
                    const pickedColor = calculatedPlayerInfo[ballistic.profileId]?.pickedColor;
                    const position = [[source.z, source.x], [target.z, target.x]];

                    const polyline = L.polyline(position, {
                        color: pickedColor ? pickedColor : 'red',
                        weight: 1,
                        opacity: 0.5,
                        fillOpacity: 0.5,
                        dashOffset: 2,
                        dashArray: [2, 6, 2]
                    });
                    polyline.eventTime = ballistic.time;
                    polyline.eventCollision = ballistic.hitPlayerId;
                    polyline.eventType = 'ballisticsLine';
                    polyline.eventId = ballisticsId;

                    polyline.addTo(MAP);
                    ballisticsLayers.set(ballisticsId, true);
                }
            }
        }

    }, [timeCurrentIndex, hideBallistics]);

    // Slider Updater
    useEffect(() => {
        if (!playing || sliderTimes.length === 0) {
            return
        }

        // Frame-skip at high speeds. Keep a fixed ~24fps render cadence and advance
        // `playbackSpeed` frames per tick, instead of shrinking the interval to
        // 1000/(24*speed) — at 16x that asked for a 2.6ms interval the browser can't
        // sustain (each tick is a full re-render), so the real speed capped at
        // whatever the machine could render. Now 16x covers 16x the timeline per
        // second at a constant render load.
        const interval = setInterval(() => {
            setTimeCurrentIndex((prevIndex) => {
                // Check if we've reached the end of the sliderTimes
                if (prevIndex >= sliderTimes.length - 1) {
                    clearInterval(interval)
                    setPlaying(false)
                    return prevIndex
                }

                const nextIndex = Math.min(prevIndex + playbackSpeed, sliderTimes.length - 1)
                const frame = sliderTimes[nextIndex]
                const startFrame = sliderTimes[Math.max(0, nextIndex - dropOffIndex)]

                if (!preserveHistory && startFrame) {
                    setTimeStartLimit(startFrame)
                }

                if (preserveHistory) {
                    setTimeStartLimit(sliderTimes[0])
                }

                setTimeEndLimit(frame)

                return nextIndex
            })
        }, 1000 / 24)

        return () => clearInterval(interval)
    }, [playing, sliderTimes, playbackSpeed, timeCurrentIndex, preserveHistory])

    // Loose Loot: fetch data lazily when toggled on
    useEffect(() => {
        if (!showLooseLoot) return
        if (looseLootData.length > 0) return // already cached
        ;(async () => {
            const data = await api.getRaidLooseLoot(raidId)
            if (data && data.length > 0) {
                setLooseLootData(data as TrackingLooseLootItem[])
            }
        })()
    }, [showLooseLoot, raidId])

    // Persist settings to localStorage
    useEffect(() => {
        localStorage.setItem('rr_looseLoot_minPrice', String(looseLootMinPrice))
    }, [looseLootMinPrice])
    useEffect(() => {
        localStorage.setItem('rr_looseLoot_filter', looseLootFilter)
    }, [looseLootFilter])
    useEffect(() => {
        localStorage.setItem('rr_showLootFloats', String(showLootFloats))
    }, [showLootFloats])
    useEffect(() => {
        localStorage.setItem('rr_showBotQuests', String(showBotQuests))
    }, [showBotQuests])
    useEffect(() => {
        localStorage.setItem('rr_showBotObjectives', String(showBotObjectives))
    }, [showBotObjectives])
    useEffect(() => {
        localStorage.setItem('rr_showPhobosField', String(showPhobosField))
    }, [showPhobosField])
    useEffect(() => {
        localStorage.setItem('rr_showPhobosAdvection', String(showPhobosAdvection))
    }, [showPhobosAdvection])
    useEffect(() => {
        localStorage.setItem('rr_showPhobosConvergence', String(showPhobosConvergence))
    }, [showPhobosConvergence])
    useEffect(() => {
        localStorage.setItem('rr_showPhobosZones', String(showPhobosZones))
    }, [showPhobosZones])
    useEffect(() => {
        localStorage.setItem('rr_showHitFlash', String(showHitFlash))
    }, [showHitFlash])

    // Build set of picked-up item IDs before current timeline position
    const pickedUpItemIds = useMemo(() => {
        const ids = new Set<string>()
        if (!raidData?.looting) return ids
        for (const loot of raidData.looting) {
            const added = loot.added === 'True' || loot.added === 'true' || loot.added === '1'
            if (added && Number(loot.time) <= timeEndLimit) {
                const iid = loot.itemId || loot.id
                if (iid) ids.add(iid)
            }
        }
        return ids
    }, [raidData?.looting, timeEndLimit])

    // Discrete timeline-progress signals (issue #24 follow-up). The overlay
    // effects below are timeline-aware but their rendered marker/tooltip set only
    // changes when an event crosses the playhead, not on every animation frame.
    // Keying those effects on these counters (instead of the continuous
    // timeEndLimit) makes them rebuild only on real changes, so hovering an
    // item / objective / loot tooltip during playback no longer flickers.
    const lootProgress = useMemo(() => {
        if (!raidData?.looting) return 0
        let n = 0
        for (const l of raidData.looting) if (Number(l.time) <= timeEndLimit) n++
        return n
    }, [raidData?.looting, timeEndLimit])

    const killProgress = useMemo(() => {
        if (!raidData?.kills) return 0
        let n = 0
        for (const k of raidData.kills) if (Number(k.time) <= timeEndLimit) n++
        return n
    }, [raidData?.kills, timeEndLimit])

    const objectiveProgress = useMemo(() => {
        let n = 0
        for (const o of botObjectiveData) if (Number(o.time) <= timeEndLimit) n++
        return n
    }, [botObjectiveData, timeEndLimit])

    const questProgress = useMemo(() => {
        let n = 0
        for (const q of botQuestData) if (Number(q.time) <= timeEndLimit) n++
        return n
    }, [botQuestData, timeEndLimit])

    const phobosSnapIdx = useMemo(() => {
        let idx = -1
        for (let i = 0; i < phobosFieldData.length; i++) {
            if (phobosFieldData[i].time <= timeEndLimit) idx = i
            else break
        }
        return idx
    }, [phobosFieldData, timeEndLimit])

    const orbitMainsProgress = useMemo(() => {
        let n = 0
        for (const e of orbitMainObjectivesData) if (Number(e.time) <= timeEndLimit) n++
        return n
    }, [orbitMainObjectivesData, timeEndLimit])

    // Loose Loot: render / update markers on map (timeline-aware + container grouping)
    useEffect(() => {
        if (!MAP || !mapIsReady) return

        // Remove old layer group
        if (looseLootLayerRef.current) {
            MAP.removeLayer(looseLootLayerRef.current)
            looseLootLayerRef.current = null
        }

        if (!showLooseLoot || looseLootData.length === 0) return

        const group = L.layerGroup()

        // Separate ground items and container items
        const groundItems: TrackingLooseLootItem[] = []
        const containerGroups: Record<string, TrackingLooseLootItem[]> = {}

        for (const item of looseLootData) {
            // Skip items picked up before current time
            if (item.itemId && pickedUpItemIds.has(item.itemId)) continue

            const totalPrice = item.price * item.qty
            if (totalPrice < looseLootMinPrice) continue

            const isContainer = item.inContainer === true || item.inContainer === 1
            if (looseLootFilter === 'ground' && isContainer) continue
            if (looseLootFilter === 'container' && !isContainer) continue

            if (isContainer) {
                const key = `${item.x},${item.y},${item.z}`
                if (!containerGroups[key]) containerGroups[key] = []
                containerGroups[key].push(item)
            } else {
                groundItems.push(item)
            }
        }

        // Render ground items as circleMarkers (SVG — much lighter than divIcon DOM elements)
        for (const item of groundItems) {
            const totalPrice = item.price * item.qty
            const color = getLootPriceColor(totalPrice)
            const marker = L.circleMarker([item.z, item.x], {
                radius: 4,
                color: 'rgba(255,255,255,0.7)',
                weight: 1,
                fillColor: color,
                fillOpacity: 0.9,
                interactive: true,
            })
            marker.bindTooltip(
                `<span style="color:${color}">\u25C6</span> ${item.itemName}${item.qty > 1 ? ' x' + item.qty : ''} \u2014 \u20BD${totalPrice.toLocaleString()}`,
                { direction: 'top', offset: [0, -8], className: 'player-tooltip player-tooltip-html' }
            )
            marker._rr_looseLoot = true
            group.addLayer(marker)
        }

        // Render container groups as circleMarkers with tooltip listing contents
        for (const [, items] of Object.entries(containerGroups)) {
            const containerTotal = items.reduce((sum, i) => sum + i.price * i.qty, 0)
            const color = getLootPriceColor(containerTotal)
            const first = items[0]
            const cName = first.containerName || 'Container'

            let tooltipHtml = `<span style="color:${color}">\u25A0</span> <strong>${cName}</strong> (${items.length}) \u2014 \u20BD${containerTotal.toLocaleString()}<div style="margin-top:3px;border-top:1px solid rgba(255,255,255,0.2);padding-top:3px;">`
            for (const item of items.sort((a, b) => (b.price * b.qty) - (a.price * a.qty))) {
                const tp = item.price * item.qty
                tooltipHtml += `<div style="font-size:10px;"><span style="color:${getLootPriceColor(tp)}">${item.itemName}</span>${item.qty > 1 ? ' x' + item.qty : ''} \u20BD${tp.toLocaleString()}</div>`
            }
            tooltipHtml += '</div>'

            const marker = L.circleMarker([first.z, first.x], {
                radius: 5,
                color: color,
                weight: 1.5,
                fillColor: color + '44',
                fillOpacity: 1,
                interactive: true,
            })
            marker.bindTooltip(tooltipHtml, { direction: 'top', offset: [0, -8], className: 'player-tooltip player-tooltip-html' })
            marker._rr_looseLoot = true
            group.addLayer(marker)
        }

        // Render dropped items (from looting events with added=false and position data)
        if (raidData?.looting && looseLootFilter !== 'container') {
            // Build set of itemIds that were picked back up before current timeline
            const rePickedIds = new Set<string>()
            for (const loot of raidData.looting) {
                const isAdded = loot.added === 'True' || loot.added === 'true' || loot.added === '1'
                if (isAdded && Number(loot.time) <= timeEndLimit) {
                    const iid = loot.itemId || loot.id
                    if (iid) rePickedIds.add(iid)
                }
            }

            for (const loot of raidData.looting) {
                const added = loot.added === 'True' || loot.added === 'true' || loot.added === '1'
                if (added) continue
                if (Number(loot.time) > timeEndLimit) continue
                // Skip if this item was picked back up before current time
                const iid = loot.itemId || loot.id
                if (iid && rePickedIds.has(iid)) continue
                const lx = Number(loot.x), lz = Number(loot.z)
                if (!lx && !lz) continue // no position data (old raids)
                const tp = (Number(loot.price) || 0) * (Number(loot.qty) || 1)
                if (tp < looseLootMinPrice) continue
                const color = getLootPriceColor(tp)
                const marker = L.circleMarker([lz, lx], {
                    radius: 4,
                    color: '#fff',
                    weight: 1,
                    fillColor: color,
                    fillOpacity: 0.9,
                    interactive: true,
                    dashArray: '3 2',
                })
                marker.bindTooltip(
                    `<span style="color:${color}">\u2B25</span> ${loot.itemName || loot.name}${Number(loot.qty) > 1 ? ' x' + loot.qty : ''} \u2014 \u20BD${tp.toLocaleString()} <span style="opacity:0.5">(dropped)</span>`,
                    { direction: 'top', offset: [0, -8], className: 'player-tooltip player-tooltip-html' }
                )
                marker._rr_looseLoot = true
                group.addLayer(marker)
            }
        }

        group.addTo(MAP)
        looseLootLayerRef.current = group

        return () => {
            if (looseLootLayerRef.current && MAP) {
                MAP.removeLayer(looseLootLayerRef.current)
                looseLootLayerRef.current = null
            }
        }
    }, [MAP, mapIsReady, showLooseLoot, looseLootData, looseLootMinPrice, looseLootFilter, raidData?.looting, lootProgress])

    // Bot Quests: always fetch data (panel visibility depends on data existing)
    useEffect(() => {
        if (botQuestData.length > 0) return
        ;(async () => {
            const data = await api.getRaidBotQuests(raidId)
            if (data && data.length > 0) {
                setBotQuestData(data)
            }
        })()
    }, [raidId])

    // Bot Quests: render objective markers on map (timeline-aware)
    useEffect(() => {
        if (!MAP || !mapIsReady) return

        if (botQuestLayerRef.current) {
            MAP.removeLayer(botQuestLayerRef.current)
            botQuestLayerRef.current = null
        }

        if (!showBotQuests || botQuestData.length === 0) return

        const group = L.layerGroup()

        // Build a map of the latest quest state per bot at current timeline position
        const latestByBot: Record<string, any> = {}
        for (const q of botQuestData) {
            const t = Number(q.time)
            if (t > timeEndLimit) continue
            const prev = latestByBot[q.profileId]
            if (!prev || t > Number(prev.time)) {
                latestByBot[q.profileId] = q
            }
        }

        const actionIcons: Record<string, string> = {
            'MoveToPosition': '\u{1F6B6}',    // walking
            'HoldAtPosition': '\u{1F6D1}',    // stop sign
            'Ambush': '\u{1F52B}',             // gun
            'Snipe': '\u{1F3AF}',              // target
            'PlantItem': '\u{1F4E6}',          // package
            'ToggleSwitch': '\u{1F511}',       // key
            'RequestExtract': '\u{1F6AA}',     // door
            'CloseNearbyDoors': '\u{1F510}',   // lock
        }

        // Build set of dead bot profileIds at current timeline
        const deadBots = new Set<string>()
        if (raidData?.kills) {
            for (const k of raidData.kills) {
                if (Number(k.time) <= timeEndLimit) deadBots.add(k.killedId)
            }
        }

        for (const [profileId, q] of Object.entries(latestByBot)) {
            if (q.status === 'Completed' || q.status === 'Archived' || q.status === 'Failed') continue
            if (deadBots.has(profileId)) continue
            const x = Number(q.objectiveX)
            const z = Number(q.objectiveZ)
            if (x === 0 && z === 0) continue

            // Find bot name from raid data
            const player = raidData?.players?.find(p => p.profileId === profileId)
            const botName = player ? (player.name || profileId) : profileId
            const icon = actionIcons[q.actionType] || '\u2753' // question mark fallback
            const isEFT = q.isEFTQuest === 1 || q.isEFTQuest === true

            const marker = L.circleMarker([z, x], {
                radius: 6,
                color: isEFT ? '#FBCFE8' : '#D946EF',
                weight: 2,
                fillColor: isEFT ? 'rgba(251,207,232,0.3)' : 'rgba(217,70,239,0.3)',
                fillOpacity: 0.7,
                interactive: true,
            })

            marker.bindTooltip(
                `${icon} <strong>${botName}</strong><br/>${q.questName}<br/><em>${q.actionType}</em> (${q.status})${isEFT ? '<br/><span style="color:#FBCFE8">EFT Quest</span>' : ''}`,
                { direction: 'top', offset: [0, -8], className: 'player-tooltip player-tooltip-html' }
            )
            marker._rr_quest = true
            group.addLayer(marker)

            // Draw a dashed line from bot's current position to the objective
            const posData = positions as any
            if (posData && typeof posData === 'object') {
                const botPositions = posData[profileId]
                if (Array.isArray(botPositions) && botPositions.length > 0) {
                    let closest = botPositions[0]
                    for (const pos of botPositions) {
                        if (Number(pos.time) <= timeEndLimit && Number(pos.time) >= Number(closest.time)) {
                            closest = pos
                        }
                    }
                    if (closest) {
                        const line = L.polyline(
                            [[Number(closest.z), Number(closest.x)], [z, x]],
                            { color: isEFT ? '#FBCFE8' : '#D946EF', weight: 1, dashArray: '4 4', opacity: 0.5 }
                        )
                        line._rr_quest = true
                        group.addLayer(line)
                    }
                }
            }
        }

        group.addTo(MAP)
        botQuestLayerRef.current = group

        return () => {
            if (botQuestLayerRef.current && MAP) {
                MAP.removeLayer(botQuestLayerRef.current)
                botQuestLayerRef.current = null
            }
        }
    }, [MAP, mapIsReady, showBotQuests, botQuestData, questProgress, killProgress, raidData?.players, raidData?.kills, positions])

    // Bot Objectives (legacy Phobos / ORBIT): always fetch data (panel
    // visibility depends on data existing). Pulls from BOTH the legacy
    // bot_objective table and the orbit_bot_objective table and merges.
    // Only one is populated at runtime — the legacy fetch is harmless
    // when no row exists and lets old raid replays keep rendering.
    useEffect(() => {
        if (botObjectiveData.length > 0) return
        ;(async () => {
            const [legacy, v2] = await Promise.all([
                api.getRaidBotObjectives(raidId),
                api.getRaidOrbitBotObjectives(raidId),
            ])
            const merged = [...(legacy || []), ...(v2 || [])]
            if (merged.length > 0) {
                setBotObjectiveData(merged)
            }
        })()
    }, [raidId])

    // Bot Objectives (Phobos): render destination markers on map (timeline-aware)
    useEffect(() => {
        if (!MAP || !mapIsReady) return

        if (botObjectiveLayerRef.current) {
            MAP.removeLayer(botObjectiveLayerRef.current)
            botObjectiveLayerRef.current = null
        }

        if (!showBotObjectives || botObjectiveData.length === 0) return

        const group = L.layerGroup()

        // Latest objective per bot at current timeline position
        const latestByBot: Record<string, any> = {}
        for (const o of botObjectiveData) {
            const t = Number(o.time)
            if (t > timeEndLimit) continue
            const prev = latestByBot[o.profileId]
            if (!prev || t > Number(prev.time)) {
                latestByBot[o.profileId] = o
            }
        }

        // Category → icon + color (Phobos LocationCategory)
        const categoryStyle: Record<string, { icon: string, color: string }> = {
            'ContainerLoot': { icon: '\u{1F4E6}', color: '#FACC15' }, // package, yellow
            'LooseLoot':     { icon: '\u{1F48E}', color: '#FBBF24' }, // gem, amber
            'Quest':         { icon: '\u{1F4CB}', color: '#D946EF' }, // clipboard, fuchsia
            'Synthetic':     { icon: '\u{1F500}', color: '#38BDF8' }, // shuffle, sky
            'Exfil':         { icon: '\u{1F6AA}', color: '#2DD4BF' }, // door, teal
        }

        // Dead bots at current timeline
        const deadBots = new Set<string>()
        if (raidData?.kills) {
            for (const k of raidData.kills) {
                if (Number(k.time) <= timeEndLimit) deadBots.add(k.killedId)
            }
        }

        for (const [profileId, o] of Object.entries(latestByBot)) {
            if (o.status !== 'Moving') continue
            if (deadBots.has(profileId)) continue
            const x = Number(o.objectiveX)
            const z = Number(o.objectiveZ)
            if (x === 0 && z === 0) continue

            const player = raidData?.players?.find(p => p.profileId === profileId)
            const botName = player ? (player.name || profileId) : profileId
            const style = categoryStyle[o.category] || { icon: '❓', color: '#94A3B8' }
            const isLeader = o.isLeader === 1 || o.isLeader === true

            const marker = L.circleMarker([z, x], {
                radius: isLeader ? 7 : 5,
                color: style.color,
                weight: isLeader ? 3 : 2,
                fillColor: style.color,
                fillOpacity: 0.3,
                interactive: true,
            })
            marker.bindTooltip(
                `${style.icon} <strong>${botName}</strong>${isLeader ? ' ★' : ''}<br/><em>${o.category || 'Objective'}</em>`,
                { direction: 'top', offset: [0, -8], className: 'player-tooltip player-tooltip-html' }
            )
            marker._rr_objective = true
            group.addLayer(marker)

            // Dashed line from bot's current position to the destination
            const posData = positions as any
            if (posData && typeof posData === 'object') {
                const botPositions = posData[profileId]
                if (Array.isArray(botPositions) && botPositions.length > 0) {
                    let closest = botPositions[0]
                    for (const pos of botPositions) {
                        if (Number(pos.time) <= timeEndLimit && Number(pos.time) >= Number(closest.time)) {
                            closest = pos
                        }
                    }
                    if (closest) {
                        const line = L.polyline(
                            [[Number(closest.z), Number(closest.x)], [z, x]],
                            { color: style.color, weight: 1, dashArray: '4 4', opacity: 0.5 }
                        )
                        line._rr_objective = true
                        group.addLayer(line)
                    }
                }
            }
        }

        group.addTo(MAP)
        botObjectiveLayerRef.current = group

        return () => {
            if (botObjectiveLayerRef.current && MAP) {
                MAP.removeLayer(botObjectiveLayerRef.current)
                botObjectiveLayerRef.current = null
            }
        }
    }, [MAP, mapIsReady, showBotObjectives, botObjectiveData, objectiveProgress, killProgress, raidData?.players, raidData?.kills, positions])

    // Phobos / ORBIT advection field: fetch snapshots once from both
    // sources and merge. Same shape, just two independent tables — drop
    // the upstream call when upstream support is removed.
    useEffect(() => {
        if (phobosFieldData.length > 0) return
        ;(async () => {
            const [legacy, v2] = await Promise.all([
                api.getRaidPhobosField(raidId),
                api.getRaidOrbitField(raidId),
            ])
            const data = [...(legacy || []), ...(v2 || [])]
            if (data.length > 0) {
                // advection/convergence/zones come back as JSON strings —
                // parse them. convergence is empty for ORBIT raids
                // (the v1-only player-attraction field) and populated
                // for legacy v1 raids.
                const parsed = data.map((s: any) => ({
                    time: Number(s.time),
                    gridCols: Number(s.gridCols),
                    gridRows: Number(s.gridRows),
                    worldMinX: Number(s.worldMinX),
                    worldMinZ: Number(s.worldMinZ),
                    cellSize: Number(s.cellSize),
                    advection: typeof s.advection === 'string' ? JSON.parse(s.advection) : (s.advection || []),
                    convergence: typeof s.convergence === 'string' ? JSON.parse(s.convergence) : (s.convergence || []),
                    zones: typeof s.zones === 'string' ? JSON.parse(s.zones) : (s.zones || []),
                }))
                setPhobosFieldData(parsed)
            }
        })()
    }, [raidId])

    // Phobos advection field: render overlay (timeline-aware — picks the snapshot for the current time)
    useEffect(() => {
        if (!MAP || !mapIsReady) return

        if (phobosFieldLayerRef.current) {
            MAP.removeLayer(phobosFieldLayerRef.current)
            phobosFieldLayerRef.current = null
        }

        if (!showPhobosField || phobosFieldData.length === 0) return

        // Pick the latest snapshot at or before the current timeline position
        let snap = phobosFieldData[0]
        for (const s of phobosFieldData) {
            if (s.time <= timeEndLimit) snap = s
            else break
        }
        if (!snap) return

        const group = L.layerGroup()
        const { worldMinX, worldMinZ, cellSize } = snap

        // Cell (cx,cy) → world center. Map plots as [z, x].
        const cellCenter = (cx: number, cy: number): [number, number] => [
            worldMinZ + (cy + 0.5) * cellSize,
            worldMinX + (cx + 0.5) * cellSize,
        ]

        // Draw a force vector as an arrow (shaft + V-shaped head) from a cell center
        const drawArrow = (cx: number, cy: number, fx: number, fz: number, color: string) => {
            const mag = Math.sqrt(fx * fx + fz * fz)
            if (mag < 0.01) return
            const [cz, cxw] = cellCenter(cx, cy)
            // Normalized direction (dz = z-axis, dx = x-axis), scaled to ~half a cell
            const dz = fz / mag, dx = fx / mag
            const scale = Math.min(mag, 1) * cellSize * 0.45
            const ez = cz + dz * scale
            const ex = cxw + dx * scale
            // Arrowhead barbs: direction rotated ±150°, length ~35% of the arrow
            const headLen = scale * 0.35
            const rot = (a: number, b: number, ang: number): [number, number] => [
                a * Math.cos(ang) - b * Math.sin(ang),
                a * Math.sin(ang) + b * Math.cos(ang),
            ]
            const ang = (150 * Math.PI) / 180
            const [b1z, b1x] = rot(dz, dx, ang)
            const [b2z, b2x] = rot(dz, dx, -ang)
            const shaft = L.polyline([[cz, cxw], [ez, ex]], { color, weight: 1.5, opacity: 0.75 })
            shaft._rr_phobos = true
            group.addLayer(shaft)
            const head = L.polyline(
                [[ez + b1z * headLen, ex + b1x * headLen], [ez, ex], [ez + b2z * headLen, ex + b2x * headLen]],
                { color, weight: 1.5, opacity: 0.75 }
            )
            head._rr_phobos = true
            group.addLayer(head)
        }

        // Advection field (static zones) — amber
        if (showPhobosAdvection) {
            for (const c of snap.advection) {
                drawArrow(c.x, c.y, c.fx, c.fz, '#F59E0B')
            }
        }
        // Convergence field (player attraction) — cyan. Legacy Phobos
        // v1 only — ORBIT always emits an empty array. Safe to loop
        // unconditionally; the toggle is hidden from the sidebar when
        // no snapshot in the raid carries any convergence data.
        if (showPhobosConvergence) {
            for (const c of snap.convergence) {
                drawArrow(c.x, c.y, c.fx, c.fz, '#22D3EE')
            }
        }

        // Hot zones — green = attractor (positive force), red = repulsor (negative)
        if (showPhobosZones)
        for (const z of snap.zones) {
            const [cz, cxw] = cellCenter(z.x, z.y)
            const isAttractor = z.force >= 0
            const color = isAttractor ? '#22C55E' : '#EF4444'
            const circle = L.circle([cz, cxw], {
                radius: z.radius,
                color,
                weight: 2,
                fillColor: color,
                fillOpacity: 0.08,
                dashArray: '4 4',
            })
            circle.bindTooltip(
                `${isAttractor ? '🟢 Attractor' : '🔴 Repulsor'}<br/>force: ${z.force.toFixed(2)}, radius: ${z.radius.toFixed(0)}`,
                { direction: 'top', className: 'player-tooltip player-tooltip-html' }
            )
            circle._rr_phobos = true
            group.addLayer(circle)
        }

        group.addTo(MAP)
        phobosFieldLayerRef.current = group

        return () => {
            if (phobosFieldLayerRef.current && MAP) {
                MAP.removeLayer(phobosFieldLayerRef.current)
                phobosFieldLayerRef.current = null
            }
        }
    }, [MAP, mapIsReady, showPhobosField, showPhobosAdvection, showPhobosConvergence, showPhobosZones, phobosFieldData, phobosSnapIdx])

    // (Phobos POIs / squad-home / squad-main-force debug overlays were
    // removed — they served their purpose during integration validation
    // but bloated the DB and cluttered the sidebar without informing the
    // user-facing playback. The on-map main-objective markers + per-bot
    // objective tooltip stay; everything else under "Phobos" is gone.)

    // ORBIT main objectives: fetch once per raid. Each DB row is one
    // 30s snapshot of every squad's main-objective list; we keep them
    // separate so the viz can replay completion progress over time.
    useEffect(() => {
        if (orbitMainObjectivesData.length > 0) return
        ;(async () => {
            const data = await api.getRaidOrbitMainObjectives(raidId)
            if (data && data.length > 0) {
                const parsed = data.map((row: any) => ({
                    time: Number(row.time) || 0,
                    squads: typeof row.squads === 'string' ? JSON.parse(row.squads) : (row.squads || []),
                }))
                setOrbitMainObjectivesData(parsed)
            }
        })()
    }, [raidId])

    // Quest name map: fetched once per page load (server side caches it
    // too — re-fetches are cheap). Independent of the active raid since
    // the SPT quest db is global.
    useEffect(() => {
        if (Object.keys(questNameMap).length > 0) return
        ;(async () => {
            const map = await api.getQuestNames()
            if (map && Object.keys(map).length > 0) setQuestNameMap(map)
        })()
    }, [])

    // ORBIT main objectives: render the selected squad's mains as
    // numbered colour-coded markers + a thin connecting polyline. Only
    // renders when selectedSquadForMains is set (set by clicking a bot
    // marker — handled in the player-marker click effect below).
    useEffect(() => {
        if (!MAP || !mapIsReady) return

        if (orbitMainObjectivesLayerRef.current) {
            MAP.removeLayer(orbitMainObjectivesLayerRef.current)
            orbitMainObjectivesLayerRef.current = null
        }

        if (selectedSquadForMains == null || orbitMainObjectivesData.length === 0) return

        // Prefer the latest snapshot ≤ timeEndLimit (timeline-accurate
        // completion flags), fall back to the freshest any-time entry
        // for disbanded squads so the markers still render.
        const squadEntry = findLatestSquadEntry(selectedSquadForMains, timeEndLimit)
        if (!squadEntry || !squadEntry.mainObjectives || squadEntry.mainObjectives.length === 0) return

        const group = L.layerGroup()
        // Rebuild marker refs alongside the group so the sidebar list
        // can call openTooltip on a hovered row's marker.
        orbitMainObjectiveMarkersRef.current = []
        const colorByType: Record<string, string> = {
            Kills: '#EF4444',     // red
            LootValue: '#F59E0B', // gold
            Quest: '#A855F7',     // purple
        }
        // Single-glyph identifier inside each marker — no number,
        // because the squad picks mains opportunistically (closest
        // pending). A number would imply an execution order that
        // doesn't exist.
        const glyphByType: Record<string, string> = {
            Kills: 'K',
            LootValue: '$',
            Quest: '?',
        }

        squadEntry.mainObjectives.forEach((m: any) => {
            const baseColor = colorByType[m.type] || '#888'
            // Four visual states: completed (grey), interrupted
            // (amber halo — LootValue paused by combat or out-of-cell),
            // in progress (white halo + thicker), pending (regular).
            // Quest has no started/interrupted state — it transitions
            // straight from pending to completed at trigger touch.
            const isStarted = !m.completed && (
                (m.type === 'Kills' && m.killsRoamStartedAt > 0) ||
                (m.type === 'LootValue' && m.lootValueEnteredAt > 0)
            )
            const isInterrupted = isStarted && m.type === 'LootValue' && m.lootValueInterrupted === true
            const fillColor = m.completed ? '#6B7280' : baseColor
            const ringColor = m.completed
                ? '#4B5563'
                : isInterrupted ? '#F59E0B'        // amber — interrupted
                : isStarted ? '#FFFFFF'             // white — in progress
                : baseColor                          // pending
            const ringWeight = isStarted ? 4 : 2.5
            const glyph = m.completed ? '✓' : (glyphByType[m.type] || '●')
            const marker = L.circleMarker([m.z, m.x], {
                radius: isStarted ? 13 : 11,
                color: ringColor,
                weight: ringWeight,
                fillColor: fillColor,
                fillOpacity: 0.85,
                dashArray: isInterrupted ? '6 4' : undefined,
            })
            const labelIcon = L.divIcon({
                className: 'rr-main-objective-label',
                html: `<div style="color:#fff;font-size:11px;font-weight:bold;text-shadow:0 0 3px rgba(0,0,0,0.9);text-align:center;line-height:22px;width:22px;">${glyph}</div>`,
                iconSize: [22, 22],
                iconAnchor: [11, 11],
            })
            const label = L.marker([m.z, m.x], { icon: labelIcon, interactive: false })
            let tipHtml = `<strong>${m.type}</strong>`
            if (m.type === 'Quest') {
                const friendly = resolveQuestName(m.questTriggerId || m.questTitle, questNameMap)
                tipHtml += `<br/><span style="opacity:0.85">${friendly || m.questTitle || m.questTriggerId || ''}</span>`
            }
            if (m.type === 'Kills' && m.killsRoamTargetDuration > 0) {
                tipHtml += `<br/><span style="opacity:0.7;font-size:10px">Roam ${m.killsRoamTargetDuration.toFixed(0)}s</span>`
            }
            if (m.type === 'LootValue' && m.lootValueTotal > 0) {
                tipHtml += `<br/><span style="opacity:0.7;font-size:10px">₽ ${Math.round(m.lootValueTotal).toLocaleString()}</span>`
            }
            const stateLabel = m.completed
                ? '✓ completed'
                : isInterrupted ? '⏸ interrupted (combat or out of cell)'
                : isStarted ? '◉ in progress (started)'
                : 'pending'
            tipHtml += `<br/><span style="opacity:0.7;font-size:10px">${stateLabel}</span>`
            marker.bindTooltip(tipHtml, { direction: 'top', className: 'player-tooltip player-tooltip-html' })
            group.addLayer(marker)
            group.addLayer(label)
            orbitMainObjectiveMarkersRef.current.push(marker)
        })

        group.addTo(MAP)
        orbitMainObjectivesLayerRef.current = group

        return () => {
            if (orbitMainObjectivesLayerRef.current && MAP) {
                MAP.removeLayer(orbitMainObjectivesLayerRef.current)
                orbitMainObjectivesLayerRef.current = null
            }
        }
    }, [MAP, mapIsReady, selectedSquadForMains, orbitMainObjectivesData, orbitMainsProgress, questNameMap])

    // Loot float animations: show floating text when timeline crosses a loot event
    // Uses a ref-based approach to avoid useEffect cleanup killing the animation on re-render
    const lootFloatTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())
    // Track active float count per approximate position to stack them
    const lootFloatStackRef = useRef<Record<string, number>>({})

    useEffect(() => {
        if (!MAP || !mapIsReady || !showLootFloats) {
            prevTimeEndLimitRef.current = timeEndLimit
            return
        }

        const prevTime = prevTimeEndLimitRef.current
        prevTimeEndLimitRef.current = timeEndLimit

        // Only show floats when timeline moves forward (not scrubbing backward)
        if (timeEndLimit <= prevTime) return

        if (!raidData?.looting) return

        // Find loot events in the time window that just passed
        const newLoots = raidData.looting.filter(l => {
            const t = Number(l.time)
            const added = l.added === 'True' || l.added === 'true' || l.added === '1'
            return added && t > prevTime && t <= timeEndLimit && l.x && l.z
        })

        if (newLoots.length === 0) return

        // Each loot event gets its own independent layer + timer
        // Stagger vertically based on how many floats are already active at this position
        for (let li = 0; li < newLoots.length; li++) {
            const loot = newLoots[li]
            const price = (loot.price || 0) * Number(loot.qty || 1)
            const priceStr = price > 0 ? ` \u20BD${price.toLocaleString()}` : ''
            const color = getLootPriceColor(price)

            // Round position to group nearby floats together
            const posKey = `${Math.round(Number(loot.z))},${Math.round(Number(loot.x))}`
            const stackIndex = lootFloatStackRef.current[posKey] || 0
            lootFloatStackRef.current[posKey] = stackIndex + 1
            const yOffset = stackIndex * 18

            const icon = L.divIcon({
                className: '',
                html: `<div class="loot-float-label" style="color:${color}">+${loot.itemName || loot.name}${priceStr}</div>`,
                iconSize: [200, 20],
                iconAnchor: [100, 20 + yOffset],
            })
            const marker = L.marker([Number(loot.z), Number(loot.x)], { icon, interactive: false, zIndexOffset: 2000 + stackIndex })
            marker.addTo(MAP)

            // Self-cleaning timer — decrement stack count when animation ends
            const timer = setTimeout(() => {
                if (MAP) MAP.removeLayer(marker)
                lootFloatTimersRef.current.delete(timer)
                if (lootFloatStackRef.current[posKey] > 0) lootFloatStackRef.current[posKey]--
            }, 5200)
            lootFloatTimersRef.current.add(timer)
        }
    }, [MAP, mapIsReady, showLootFloats, timeEndLimit, raidData?.looting])

    // Hit flash animations: show a red flash when a bot/player gets hit
    useEffect(() => {
        if (!MAP || !mapIsReady || !showHitFlash) {
            prevTimeHitRef.current = timeEndLimit
            return
        }

        const prevTime = prevTimeHitRef.current
        prevTimeHitRef.current = timeEndLimit

        if (timeEndLimit <= prevTime) return
        if (!raidData?.ballistic) return

        const newHits = raidData.ballistic.filter(b => {
            const t = Number(b.time)
            return b.hitPlayerId && t > prevTime && t <= timeEndLimit
        })

        if (newHits.length === 0) return

        for (const hit of newHits) {
            try {
                const target = JSON.parse(hit.target)
                const icon = L.divIcon({
                    className: '',
                    html: `<div class="hit-flash-marker"></div>`,
                    iconSize: [10, 10],
                    iconAnchor: [5, 5],
                })
                const marker = L.marker([target.z, target.x], { icon, interactive: false, zIndexOffset: 3000 })
                marker.addTo(MAP)

                const timer = setTimeout(() => {
                    if (MAP) MAP.removeLayer(marker)
                    hitFlashTimersRef.current.delete(timer)
                }, 900)
                hitFlashTimersRef.current.add(timer)
            } catch {}
        }
    }, [MAP, mapIsReady, showHitFlash, timeEndLimit, raidData?.ballistic])

    // Compute filtered loot stats (timeline-aware)
    const looseLootStats = useMemo(() => {
        if (looseLootData.length === 0) return { shown: 0, total: 0, ground: 0, container: 0 }
        let ground = 0
        let container = 0
        let shown = 0
        for (const item of looseLootData) {
            if (item.itemId && pickedUpItemIds.has(item.itemId)) continue
            const isContainer = item.inContainer === true || item.inContainer === 1
            if (isContainer) container++
            else ground++
            const totalPrice = item.price * item.qty
            if (totalPrice < looseLootMinPrice) continue
            if (looseLootFilter === 'ground' && isContainer) continue
            if (looseLootFilter === 'container' && !isContainer) continue
            shown++
        }
        return { shown, total: looseLootData.length, ground, container }
    }, [looseLootData, looseLootMinPrice, looseLootFilter, pickedUpItemIds])

    // Slots that are not lootable (excluded from value totals)
    const NON_LOOTABLE_SLOTS = /^(main|SecuredContainer)$/i

    // Compute bot spawn values from player_inventory (exclude non-lootable slots)
    const botSpawnValues = useMemo(() => {
        const values: Record<string, number> = {}
        if (raidData.player_inventory) {
            for (const item of raidData.player_inventory) {
                if (NON_LOOTABLE_SLOTS.test(item.slot || '')) continue
                if (!values[item.profileId]) values[item.profileId] = 0
                values[item.profileId] += item.price * item.qty
            }
        }
        return values
    }, [raidData.player_inventory])

    // Bots with inventory data (for inspector dropdown)
    const botsWithInventory = useMemo(() => {
        if (!raidData.player_inventory || !raidData.players) return []
        const profileIds = new Set(raidData.player_inventory.map(i => i.profileId))
        return raidData.players.filter(p => profileIds.has(p.profileId))
    }, [raidData.player_inventory, raidData.players])

    // Equipment-level slot display order
    const EQUIPMENT_SLOT_ORDER = [
        'FirstPrimaryWeapon', 'SecondPrimaryWeapon', 'Holster', 'Scabbard',
        'Headwear', 'Earpiece', 'FaceCover', 'ArmorVest', 'TacticalVest',
        'Pockets', 'Backpack', 'SecuredContainer', 'ArmBand',
        'SpecialSlot1', 'SpecialSlot2', 'SpecialSlot3',
    ]
    const WEAPON_SLOTS = new Set(['FirstPrimaryWeapon', 'SecondPrimaryWeapon', 'Holster', 'Scabbard'])

    // Slot grouping rules: pattern → parent group name
    const SLOT_GROUP_RULES: { pattern: RegExp; name: string }[] = [
        { pattern: /^mod_|^cartridges$|^patron_in_weapon$/i, name: '__weapon_att__' },
        { pattern: /^helmet_/i, name: 'Helmet parts' },
        { pattern: /^soft_armor_/i, name: 'Soft armor parts' },
        { pattern: /^heavy_armor_/i, name: 'Heavy armor parts' },
        { pattern: /_plate$/i, name: 'Armor plates' },
        { pattern: /^pocket/i, name: '__merge_Pockets__' },  // merge into Pockets equipment slot
    ]
    // Slots to completely hide
    const HIDDEN_SLOT = /^(\d+|[0-9a-f]{20,}|Default Inventory|unknown|camora_|GridView)/i

    // Selected bot inventory: equipment groups + weapon attachments nested under weapons
    interface InvSubGroup { name: string; items: TrackingPlayerInventoryItem[]; total: number }
    interface InvSlotGroup { name: string; items: TrackingPlayerInventoryItem[]; total: number; attachments?: InvSubGroup; subGroups?: InvSubGroup[] }
    const selectedBotInventory = useMemo(() => {
        if (!selectedBotProfileId || !raidData.player_inventory) return { slots: [] as InvSlotGroup[], total: 0 }
        const items = raidData.player_inventory.filter(i => i.profileId === selectedBotProfileId)

        const equipmentGroups: Record<string, TrackingPlayerInventoryItem[]> = {}
        const weaponAttachments: TrackingPlayerInventoryItem[] = []
        const groupedSlots: Record<string, TrackingPlayerInventoryItem[]> = {}  // helmet_*, soft_armor_*, etc.
        let total = 0

        for (const item of items) {
            const slot = item.slot || 'unknown'
            const val = item.price * item.qty
            // Exclude non-lootable slots from total
            if (!NON_LOOTABLE_SLOTS.test(slot)) total += val

            // Hidden slots
            if (HIDDEN_SLOT.test(slot)) continue

            // Check grouping rules
            let matched = false
            for (const rule of SLOT_GROUP_RULES) {
                if (rule.pattern.test(slot)) {
                    if (rule.name === '__weapon_att__') {
                        weaponAttachments.push(item)
                    } else if (rule.name.startsWith('__merge_') && rule.name.endsWith('__')) {
                        // Merge directly into the target equipment slot
                        const targetSlot = rule.name.slice(8, -2) // "__merge_Pockets__" → "Pockets"
                        if (!equipmentGroups[targetSlot]) equipmentGroups[targetSlot] = []
                        equipmentGroups[targetSlot].push(item)
                    } else {
                        if (!groupedSlots[rule.name]) groupedSlots[rule.name] = []
                        groupedSlots[rule.name].push(item)
                    }
                    matched = true
                    break
                }
            }
            if (matched) continue

            // Equipment-level slot
            if (!equipmentGroups[slot]) equipmentGroups[slot] = []
            equipmentGroups[slot].push(item)
        }

        // Build ordered slot groups
        const slots: InvSlotGroup[] = []
        const usedSlots = new Set<string>()

        // Add in preferred order first
        for (const slotName of EQUIPMENT_SLOT_ORDER) {
            if (equipmentGroups[slotName]) {
                const grpItems = equipmentGroups[slotName]
                const grpTotal = grpItems.reduce((s, i) => s + i.price * i.qty, 0)
                const group: InvSlotGroup = { name: slotName, items: grpItems, total: grpTotal }

                // Attach weapon accessories to first weapon slot that has items
                if (WEAPON_SLOTS.has(slotName) && weaponAttachments.length > 0 && !usedSlots.has('__att__')) {
                    const weaponName = grpItems[0]?.itemName || slotName
                    const attTotal = weaponAttachments.reduce((s, i) => s + i.price * i.qty, 0)
                    group.attachments = { name: weaponName, items: weaponAttachments, total: attTotal }
                    usedSlots.add('__att__')
                }

                // Attach grouped sub-slots (helmet_*, armor, plates, pockets) to their parent equipment slot
                const subGroups: InvSubGroup[] = []
                const armorParents: Record<string, string[]> = {
                    'Headwear': ['Helmet parts'],
                    'ArmorVest': ['Soft armor parts', 'Heavy armor parts', 'Armor plates'],
                    'TacticalVest': ['Soft armor parts', 'Heavy armor parts', 'Armor plates'],
                }
                const parentGroupNames = armorParents[slotName]
                if (parentGroupNames) {
                    for (const gn of parentGroupNames) {
                        if (groupedSlots[gn] && groupedSlots[gn].length > 0) {
                            const sgTotal = groupedSlots[gn].reduce((s, i) => s + i.price * i.qty, 0)
                            subGroups.push({ name: gn, items: groupedSlots[gn], total: sgTotal })
                            delete groupedSlots[gn]
                        }
                    }
                }
                if (subGroups.length > 0) group.subGroups = subGroups

                slots.push(group)
                usedSlots.add(slotName)
            }
        }

        // Add any remaining equipment slots not in the predefined order
        for (const slotName of Object.keys(equipmentGroups)) {
            if (usedSlots.has(slotName)) continue
            const grpItems = equipmentGroups[slotName]
            const grpTotal = grpItems.reduce((s, i) => s + i.price * i.qty, 0)
            const group: InvSlotGroup = { name: slotName, items: grpItems, total: grpTotal }
            slots.push(group)
        }

        // Add any remaining grouped slots that didn't attach to a parent
        for (const [gn, gItems] of Object.entries(groupedSlots)) {
            if (gItems.length === 0) continue
            const gTotal = gItems.reduce((s, i) => s + i.price * i.qty, 0)
            slots.push({ name: gn, items: gItems, total: gTotal })
        }

        // For 'main' slot: group duplicates by templateId
        for (const group of slots) {
            if (group.name === 'main') {
                const merged: Record<string, TrackingPlayerInventoryItem> = {}
                for (const item of group.items) {
                    const key = item.templateId || item.itemName
                    if (merged[key]) {
                        merged[key] = { ...merged[key], qty: merged[key].qty + item.qty }
                    } else {
                        merged[key] = { ...item }
                    }
                }
                group.items = Object.values(merged)
            }
        }

        return { slots, total }
    }, [selectedBotProfileId, raidData.player_inventory])

    // Reset collapsed slots when bot changes
    useEffect(() => {
        if (!selectedBotProfileId) return
        const defaults: Record<string, boolean> = {}
        for (const group of selectedBotInventory.slots) {
            // Collapse: SecondPrimaryWeapon, main
            defaults[group.name] = group.name === 'SecondPrimaryWeapon' || group.name === 'main'
            // Weapon attachments always collapsed by default
            if (group.attachments) {
                defaults[`${group.name}__att`] = true
            }
            // Sub-groups collapsed by default
            if (group.subGroups) {
                for (const sg of group.subGroups) {
                    defaults[`${group.name}__${sg.name}`] = true
                }
            }
        }
        setCollapsedSlots(defaults)
    }, [selectedBotProfileId])

    function clearMap(m, timeRange) {
        if (!m || !mapIsReady) return;
    
        for (const key in m._layers) {
            const layer = m._layers[key];
        
            // Skip layers managed by other overlays (quests, loose loot, grenades, etc.)
            if (layer._rr_quest || layer._rr_looseLoot || layer._rr_grenade || layer._rr_objective || layer._rr_phobos) continue;

            // Persistent player-dot markers (issue #24) are mutated in place across
            // frames, not torn down here; their lifecycle is reconciled in the main
            // render effect. Other markers/polylines/circles still get cleared.
            if (layer._rr_persistentPlayer) continue;

            // Focus kill-visualization layers (kill/death lines, skull markers,
            // dead-player temp marker) are now rebuilt only on focus/kill changes
            // (gated by killVizSig), so clearMap must NOT strip them every frame —
            // otherwise the skulls vanish mid-playback. The focus effect owns their
            // teardown via focusLayersRef.
            if (layer._rr_focusViz) continue;

            // Remove polylines without eventType or not being ballisticsLine, circles, and special bot markers
            const isSpecialBotMarker = layer instanceof L.Marker && layer.options?.icon?.options?.className === 'special-bot-marker';
            const isFollowKillMarker = layer instanceof L.Marker && layer.options?.icon?.options?.className?.includes('follow-kill-marker');
            if ((layer instanceof L.Polyline && (!layer.eventType || layer.eventType !== 'ballisticsLine')) || layer instanceof L.Circle || isSpecialBotMarker || isFollowKillMarker) {
                m.removeLayer(layer);
                continue;
            }
    
            // Handle ballistics lines
            if (layer.eventTime) {
                const toBeIndex = findInsertIndex(layer.eventTime, sliderTimes);
    
                let passedTime = toBeIndex > timeCurrentIndex;
                let expiredTime = toBeIndex + 40 < timeCurrentIndex ;
    
                if (layer.eventType === 'ballisticsLine' && (expiredTime || passedTime)) {
                    m.removeLayer(layer);
                    ballisticsLayers.delete(layer.eventId);
                }
            }
        }
    } 

    function playPositions() {
        if (timeCurrentIndex === sliderTimes.length - 1) {
            setTimeEndLimit(sliderTimes[0])
            setTimeStartLimit(sliderTimes[0])
            setTimeCurrentIndex(0)
        }
        setPlaying((prevPlaying) => !prevPlaying)
    }

    function highlight(coords, time) {
        if (!MAP) return
        const frameIndex = Math.min(findInsertIndex(time, sliderTimes) + 1, sliderTimes.length - 1)
        setTimeCurrentIndex(frameIndex)
        setTimeEndLimit(sliderTimes[frameIndex] ?? sliderTimes[sliderTimes.length - 1] ?? 0)
        setTimeStartLimit(sliderTimes[Math.max(0, frameIndex - dropOffIndex)] ?? 0)
        MAP.flyToBounds(coords, { maxZoom: 4, animate: true })
        return
    }

    function playerIsDead(playerId: string, time: number): boolean {
        if (raidData && raidData.kills) {
            let playerWasKilled = !!raidData.kills.find((kill) => kill.killedId === playerId && kill.time < time);
            
            return playerWasKilled
        } else {
            return false
        }
    }

    function getPlayerBrain(player: TrackingRaidDataPlayers): string {
        if (player) {
            let brainOutput = 'Unknown'
            let botMapping = BotMapping[player.type]
            if (player.name === 'Knight') {
                botMapping = { type: 'GOON' }
            }
            if (!botMapping && typeof player.type === 'string' && player.type.includes('|')) {
                const category = player.type.split('|')[1]
                const name = player.type.split('|')[0].toLowerCase()
                if (category === 'FACTION_MOD') {
                    botMapping = { type: name.startsWith('boss') ? 'BOSS' : 'FOLLOWER' }
                } else {
                    botMapping = { type: category }
                }
            }
            if (!botMapping) {
                botMapping = { type: 'UNKNOWN' }
            }

            if ((player.team === 'Bear' || player.team === 'Usec') && player.mod_SAIN_brain != 'UNKNOWN') {
                return `${player.mod_SAIN_brain.trim()}`
            }

            if (player.mod_SAIN_brain === 'PLAYER') brainOutput = 'Human'
            if (player.mod_SAIN_brain != null) brainOutput = `${player.mod_SAIN_brain.trim()}`

            if (botMapping.type === 'UNKNOWN') brainOutput = `${player.team === 'Savage' ? 'Scav' : 'PMC'}`
            if (player.mod_SAIN_brain === 'UNKNOWN' && (player.team === 'Bear' || player.team === 'Usec')) brainOutput = 'PMC'
            if (botMapping.type === 'SCAV') brainOutput = `Scav`

            if (botMapping.type === 'BOSS') brainOutput = `Boss`

            if (botMapping.type === 'GOON') brainOutput = `Goon`
            if (botMapping.type === 'FOLLOWER') brainOutput = `Follower`
            if (botMapping.type === 'RAIDER') brainOutput = `Raider`
            if (botMapping.type === 'ROGUE') brainOutput = `Rogue`
            if (botMapping.type === 'CULT') brainOutput = `Cultist`
            if (botMapping.type === 'SNIPER') brainOutput = `Sniper`
            if (botMapping.type === 'PLAYER_SCAV') brainOutput = `${player.mod_SAIN_brain.trim()} - Player Scav`
            if (botMapping.type === 'BLOODHOUND') brainOutput = `Bloodhound`
            if (botMapping.type === 'INFECTED') brainOutput = `Infected`
            if (botMapping.type === 'OTHER') brainOutput = `BTR`

            return brainOutput
        }
    }

    function getPlayerDifficultyAndBrain(player: TrackingRaidDataPlayers): string {
        if (player) {
            let difficulty = player.mod_SAIN_difficulty
            let brain = getPlayerBrain(player)
            // For faction-mod bots, show only their specific role (Rifleman, Grenadier, etc.)
            if (classifyPlayer(player) === 'FACTION') {
                const role = getFactionRole(player)
                if (role) return role
            }
            if (difficulty !== null && difficulty !== '') {
                return `${difficulty} - ${brain}`
            }
            return `${brain}`
        }

        return ''
    }

    return (
        <div className="map-container" key="map-wrapper">
            <div className="parent">
                <nav className="flex top">
                    <div>
                        {availableLayers.map((layer) => (
                            <button
                                key={layer.value}
                                className={`text-sm p-2 mr-2 py-1 text-sm ${layer.value === selectedLayer ? 'bg-eft text-black' : 'cursor-pointer border border-eft text-eft'} mb-2 ml-auto`}
                                onClick={() => setSelectedLayer(layer.value)}
                            >
                                {layer.name}
                            </button>
                        ))}
                    </div>
                    <div className="ml-4">
                        {availableStyles.map((style) =>
                            style.name ? (
                                <button
                                    key={style.value}
                                    className={`text-sm p-2 mr-2 py-1 text-sm ${style.value === selectedStyle ? 'bg-eft text-black' : 'cursor-pointer border border-eft text-eft'} mb-2 ml-auto`}
                                    onClick={() => setSelectedStyle(style.value)}
                                >
                                    {style.name}
                                </button>
                            ) : (
                                ''
                            )
                        )}
                    </div>
                    <Link to={`/raid/${raidId}`} className="text-sm p-2 py-1 text-sm cursor-pointer border border-eft text-eft mb-2 ml-auto">
                        Close
                    </Link>
                </nav>
                <aside className="sidebar border border-eft mr-3 p-3 overflow-x-auto">
                    <div className="playerfeed text-eft">
                        <strong>Legend</strong>
                        {(() => {
                            const visiblePlayers = raidData.players.filter((p) => p.spawnTime < timeEndLimit)
                            const grouped: Record<string, { player: any, originalIndex: number }[]> = {}
                            visiblePlayers.forEach((player) => {
                                const cat = classifyPlayer(player)
                                const origIdx = raidData.players.indexOf(player)
                                if (!grouped[cat]) grouped[cat] = []
                                grouped[cat].push({ player, originalIndex: origIdx })
                            })

                            const toggleGroup = (key: string) => {
                                setCollapsedGroups(prev => {
                                    const next = new Set(prev)
                                    if (next.has(key)) next.delete(key)
                                    else next.add(key)
                                    return next
                                })
                            }

                            return LEGEND_GROUPS.filter(g => grouped[g.key]?.length > 0).map(group => {
                                const items = grouped[group.key]
                                const isCollapsed = collapsedGroups.has(group.key)

                                // PMC sub-grouping by team
                                if (group.key === 'PMC') {
                                    const teams: Record<number, { player: any, originalIndex: number }[]> = {}
                                    items.forEach(item => {
                                        const g = item.player.group ?? 0
                                        if (!teams[g]) teams[g] = []
                                        teams[g].push(item)
                                    })
                                    const teamKeys = Object.keys(teams).map(Number).sort((a, b) => a - b)

                                    return (
                                        <div key={group.key}>
                                            <div
                                                className="flex items-center cursor-pointer py-1 mt-2"
                                                style={{ borderBottom: '1px solid rgba(154, 136, 102, 0.3)', fontSize: '12px' }}
                                                onClick={() => toggleGroup(group.key)}
                                            >
                                                <span style={{ marginRight: '4px', fontSize: '8px' }}>{isCollapsed ? '\u25B6' : '\u25BC'}</span>
                                                <span>{group.label} ({items.length})</span>
                                            </div>
                                            {!isCollapsed && teamKeys.map(teamKey => {
                                                const teamPlayers = teams[teamKey]
                                                const teamColor = getPlayerColor(teamPlayers[0].player, teamPlayers[0].originalIndex)
                                                return (
                                                    <div key={teamKey}>
                                                        <div className="text-xs pl-2 pt-1" style={{ color: teamColor, opacity: 0.8 }}>
                                                            Team {teamKey}
                                                        </div>
                                                        <ul>
                                                            {teamPlayers.map(({ player, originalIndex }) => (
                                                                <li
                                                                    className="flex items-center justify-between player-legend-item px-2"
                                                                    key={player.profileId}
                                                                    style={focusVictimIds.has(player.profileId) ? { borderLeft: '3px solid #22C55E', background: 'rgba(34,197,94,0.12)' } : focusKillerId === player.profileId ? { borderLeft: '3px solid #EF4444', background: 'rgba(239,68,68,0.12)' } : undefined}
                                                                    onMouseEnter={() => { if (focusTimeoutRef.current) clearTimeout(focusTimeoutRef.current); setPlayerFocus(player.profileId) }}
                                                                    onMouseLeave={() => setPlayerFocus(null)}
                                                                    onClick={() => {
                                                                        setFollowPlayer(followPlayer === player.profileId ? null : player.profileId)
                                                                        setFollowPlayerZoomed(false)
                                                                    }}
                                                                >
                                                                    <div className={`flex flex-row items-center ${playerIsDead(player.profileId, timeEndLimit) ? 'line-through opacity-25' : ''}`}>
                                                                        {getLegendIcon(player, getPlayerColor(player, originalIndex), pmcIndexMap[player.profileId])}
                                                                        <div>
                                                                            <span className="capitalize">
                                                                                {intl(getDisplayName(player), intl_dir)} ({getPlayerDifficultyAndBrain(player)})
                                                                            </span>
                                                                            {botSpawnValues[player.profileId] > 0 && (
                                                                                <span style={{ fontSize: '9px', opacity: 0.5, marginLeft: '4px' }}>{'\u20BD'}{formatCompactNumber(botSpawnValues[player.profileId])}</span>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                    {followPlayer === player.profileId ? <span className="text-xs">[FOLLOWING]</span> : ''}
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    )
                                }

                                // Faction sub-grouping by faction type
                                if (group.key === 'FACTION') {
                                    const FACTION_LABELS: Record<string, string> = { MERCENARY: 'Mercenary', RUAF: 'RUAF', UNTAR: 'UNTAR', BLACKDIV: 'Black Div', ISB: 'ISB' }
                                    const factions: Record<string, { player: any, originalIndex: number }[]> = {}
                                    items.forEach(item => {
                                        let fType = BotMapping[item.player.type]?.type
                                        // Fallback for bots not in botMapping.json — use the category after "|"
                                        if (!fType && typeof item.player.type === 'string' && item.player.type.includes('|')) {
                                            fType = item.player.type.split('|')[1]
                                        }
                                        fType = fType || 'UNKNOWN'
                                        if (!factions[fType]) factions[fType] = []
                                        factions[fType].push(item)
                                    })
                                    const factionKeys = Object.keys(factions)

                                    return (
                                        <div key={group.key}>
                                            <div
                                                className="flex items-center cursor-pointer py-1 mt-2"
                                                style={{ borderBottom: '1px solid rgba(154, 136, 102, 0.3)', fontSize: '12px' }}
                                                onClick={() => toggleGroup(group.key)}
                                            >
                                                <span style={{ marginRight: '4px', fontSize: '8px' }}>{isCollapsed ? '\u25B6' : '\u25BC'}</span>
                                                <span>{group.label} ({items.length})</span>
                                            </div>
                                            {!isCollapsed && factionKeys.map(fKey => {
                                                const fPlayers = factions[fKey]
                                                const fColor = getPlayerColor(fPlayers[0].player, fPlayers[0].originalIndex)
                                                return (
                                                    <div key={fKey}>
                                                        <div className="text-xs pl-2 pt-1" style={{ color: fColor, opacity: 0.8 }}>
                                                            {FACTION_LABELS[fKey] || fKey}
                                                        </div>
                                                        <ul>
                                                            {fPlayers.map(({ player, originalIndex }) => (
                                                                <li
                                                                    className="flex items-center justify-between player-legend-item px-2"
                                                                    key={player.profileId}
                                                                    style={focusVictimIds.has(player.profileId) ? { borderLeft: '3px solid #22C55E', background: 'rgba(34,197,94,0.12)' } : focusKillerId === player.profileId ? { borderLeft: '3px solid #EF4444', background: 'rgba(239,68,68,0.12)' } : undefined}
                                                                    onMouseEnter={() => { if (focusTimeoutRef.current) clearTimeout(focusTimeoutRef.current); setPlayerFocus(player.profileId) }}
                                                                    onMouseLeave={() => setPlayerFocus(null)}
                                                                    onClick={() => {
                                                                        setFollowPlayer(followPlayer === player.profileId ? null : player.profileId)
                                                                        setFollowPlayerZoomed(false)
                                                                    }}
                                                                >
                                                                    <div className={`flex flex-row items-center ${playerIsDead(player.profileId, timeEndLimit) ? 'line-through opacity-25' : ''}`}>
                                                                        {getLegendIcon(player, getPlayerColor(player, originalIndex))}
                                                                        <div>
                                                                            <span className="capitalize">
                                                                                {intl(getDisplayName(player), intl_dir)} ({getPlayerDifficultyAndBrain(player)})
                                                                            </span>
                                                                            {botSpawnValues[player.profileId] > 0 && (
                                                                                <span style={{ fontSize: '9px', opacity: 0.5, marginLeft: '4px' }}>{'\u20BD'}{formatCompactNumber(botSpawnValues[player.profileId])}</span>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                    {followPlayer === player.profileId ? <span className="text-xs">[FOLLOWING]</span> : ''}
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    )
                                }

                                // Standard group
                                return (
                                    <div key={group.key}>
                                        <div
                                            className="flex items-center cursor-pointer py-1 mt-2"
                                            style={{ borderBottom: '1px solid rgba(154, 136, 102, 0.3)', fontSize: '12px' }}
                                            onClick={() => toggleGroup(group.key)}
                                        >
                                            <span style={{ marginRight: '4px', fontSize: '8px' }}>{isCollapsed ? '\u25B6' : '\u25BC'}</span>
                                            <span>{group.label} ({items.length})</span>
                                        </div>
                                        {!isCollapsed && (
                                            <ul>
                                                {items.map(({ player, originalIndex }) => (
                                                    <li
                                                        className="flex items-center justify-between player-legend-item px-2"
                                                        key={player.profileId}
                                                        style={focusVictimIds.has(player.profileId) ? { borderLeft: '3px solid #22C55E', background: 'rgba(34,197,94,0.12)' } : focusKillerId === player.profileId ? { borderLeft: '3px solid #EF4444', background: 'rgba(239,68,68,0.12)' } : undefined}
                                                        onMouseEnter={() => { if (focusTimeoutRef.current) clearTimeout(focusTimeoutRef.current); setPlayerFocus(player.profileId) }}
                                                        onMouseLeave={() => setPlayerFocus(null)}
                                                        onClick={() => {
                                                            setFollowPlayer(followPlayer === player.profileId ? null : player.profileId)
                                                            setFollowPlayerZoomed(false)
                                                        }}
                                                    >
                                                        <div className={`flex flex-row items-center ${playerIsDead(player.profileId, timeEndLimit) ? 'line-through opacity-25' : ''}`}>
                                                            {getLegendIcon(player, getPlayerColor(player, originalIndex))}
                                                            <div>
                                                                <span className="capitalize">
                                                                    {intl(getDisplayName(player), intl_dir)} ({getPlayerDifficultyAndBrain(player)})
                                                                </span>
                                                                {botSpawnValues[player.profileId] > 0 && (
                                                                    <span style={{ fontSize: '9px', opacity: 0.5, marginLeft: '4px' }}>{'\u20BD'}{formatCompactNumber(botSpawnValues[player.profileId])}</span>
                                                                )}
                                                            </div>
                                                        </div>
                                                        {followPlayer === player.profileId ? <span className="text-xs">[FOLLOWING]</span> : ''}
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </div>
                                )
                            })
                        })()}
                        {showBehavior && <div className="mt-4" style={{ borderTop: '1px solid rgba(154, 136, 102, 0.3)', paddingTop: '8px' }}>
                            <strong style={{ fontSize: '13px' }}>Bot Behavior</strong>
                            <div style={{ marginTop: '4px' }}>
                                {Object.values(BEHAVIOR_CATEGORIES).map(cat => (
                                    <div key={cat.key} className="flex items-center" style={{ padding: '2px 0', fontSize: '12px' }}>
                                        <span style={{ width: 10, height: 10, borderRadius: '50%', background: cat.color, marginRight: 6, flexShrink: 0, display: 'inline-block', boxShadow: `0 0 4px ${cat.color}` }}></span>
                                        <span>{cat.label}</span>
                                    </div>
                                ))}
                            </div>
                            {!raidData?.detectedMods?.match(/SAIN/gi) && (
                                <div style={{ marginTop: '6px', fontSize: '11px', color: '#F59E0B', opacity: 0.7 }}>
                                    SAIN recommended for detailed behavior data
                                </div>
                            )}
                        </div>}

                    </div>
                </aside>
                <div className="map-wrapper border border-eft map">
                    <TransformWrapper
                        ref={ref}
                        initialScale={1}
                        centerOnInit={true}
                        wheel={{
                            step: 0.1,
                        }}
                        key="map-holder"
                    >
                        <TransformComponent></TransformComponent>
                    </TransformWrapper>
                    <div className="kill-stream">
                        {events
                            .filter((e) => findInsertIndex(e.time, sliderTimes) < timeCurrentIndex)
                            .reverse()
                            .slice(0, 4)
                            .map((e, i) => (
                                <div className="text-black" key={`${e.profileId}_${i}`}>
                                    <span className="tooltiptext event">
                                        [
                                        <a
                                            className="underline cursor-pointer"
                                            onClick={() =>
                                                highlight(
                                                    [
                                                        [e.target.z, e.target.x],
                                                        [e.source.z, e.source.x],
                                                    ],
                                                    e.time
                                                )
                                            }
                                        >
                                            VIEW
                                        </a>
                                        ] {(() => { const p = raidData.players.find(p => p.profileId === e.profileId); const idx = p ? raidData.players.indexOf(p) : 0; return p ? getLegendIcon(p, getPlayerColor(p, idx), pmcIndexMap[p.profileId]) : null })()}<strong>{e.profileNickname}</strong> killed {(() => { const p = raidData.players.find(p => p.profileId === e.killedId); const idx = p ? raidData.players.indexOf(p) : 0; return p ? getLegendIcon(p, getPlayerColor(p, idx), pmcIndexMap[p.profileId]) : null })()}<strong>{e.killedNickname}</strong> ({intl([e.weapon.replace('Name', 'ShortName')], intl_dir)} - {e.distance.toFixed(0)}m, {e.bodyPart})
                                    </span>
                                </div>
                            ))}
                    </div>
                    <div id="view-switcher" className='border border-eft bg-black'>
                        <button className={`positional border border-eft ${heatmapEnabled ? 'opacity-50' : ''}`} onClick={() => setHeatmapEnabled(false)}>
                            
                        </button>
                        <button className={`heatmap border border-eft ${heatmapEnabled ? '' : 'opacity-50'}`} onClick={() => setHeatmapEnabled(true)}>
                            
                        </button>
                    </div>
                    <div id="leaflet-map" ref={onMapContainerRefChange} className={'leaflet-map-container'} />
                </div>
                <aside className="sidebar-right border border-eft ml-3 p-3 overflow-x-auto">
                    <div className="playerfeed text-eft">
                        {/* ── Animations Section ── */}
                        <div>
                            <div
                                className="flex items-center cursor-pointer"
                                style={{ fontSize: '14px' }}
                                onClick={() => setAnimationsCollapsed(!animationsCollapsed)}
                            >
                                <span style={{ marginRight: '4px', fontSize: '9px' }}>{animationsCollapsed ? '\u25B6' : '\u25BC'}</span>
                                <strong>Animations</strong>
                            </div>
                            {!animationsCollapsed && (
                                <div style={{ marginTop: '6px', fontSize: '13px' }}>
                                    <label className="flex items-center gap-2 cursor-pointer" style={{ marginBottom: '6px' }}>
                                        <input
                                            type="checkbox"
                                            checked={showLootFloats}
                                            onChange={() => setShowLootFloats(!showLootFloats)}
                                            style={{ accentColor: '#9a8866' }}
                                        />
                                        <span>Loot pickups</span>
                                    </label>
                                    <label className="flex items-center gap-2 cursor-pointer" style={{ marginBottom: '6px' }}>
                                        <input
                                            type="checkbox"
                                            checked={showHitFlash}
                                            onChange={() => setShowHitFlash(!showHitFlash)}
                                            style={{ accentColor: '#9a8866' }}
                                        />
                                        <span>Hit impacts</span>
                                    </label>
                                </div>
                            )}
                        </div>

                        {/* ── Loose Loot Section ── */}
                        <div>
                            <div
                                className="flex items-center cursor-pointer"
                                style={{ fontSize: '14px' }}
                                onClick={() => setLooseLootCollapsed(!looseLootCollapsed)}
                            >
                                <span style={{ marginRight: '4px', fontSize: '9px' }}>{looseLootCollapsed ? '\u25B6' : '\u25BC'}</span>
                                <strong>Loose Loot</strong>
                            </div>
                            {!looseLootCollapsed && (
                                <div style={{ marginTop: '6px', fontSize: '13px' }}>
                                    <label className="flex items-center gap-2 cursor-pointer" style={{ marginBottom: '6px' }}>
                                        <input
                                            type="checkbox"
                                            checked={showLooseLoot}
                                            onChange={() => setShowLooseLoot(!showLooseLoot)}
                                            style={{ accentColor: '#9a8866' }}
                                        />
                                        <span>Show on map</span>
                                    </label>
                                    <div style={{ marginBottom: '6px' }}>
                                        <div className="flex justify-between" style={{ fontSize: '12px', marginBottom: '2px' }}>
                                            <span>Min price</span>
                                            <span>{'\u20BD'}{looseLootMinPrice.toLocaleString()}</span>
                                        </div>
                                        <input
                                            type="range"
                                            min={0}
                                            max={500000}
                                            step={5000}
                                            value={looseLootMinPrice}
                                            onChange={(e) => setLooseLootMinPrice(Number(e.target.value))}
                                            style={{ width: '100%', accentColor: '#9a8866' }}
                                        />
                                    </div>

                                    <div style={{ marginBottom: '6px' }}>
                                        <div style={{ fontSize: '12px', marginBottom: '2px' }}>Filter</div>
                                        <select
                                            value={looseLootFilter}
                                            onChange={(e) => setLooseLootFilter(e.target.value as 'all' | 'ground' | 'container')}
                                            style={{ width: '100%', background: '#1a1a1a', color: '#9a8866', border: '1px solid #9a8866', padding: '3px 4px', fontSize: '12px' }}
                                        >
                                            <option value="all">All</option>
                                            <option value="ground">Ground only</option>
                                            <option value="container">Container only</option>
                                        </select>
                                    </div>

                                    <div style={{ fontSize: '11px', opacity: 0.7, marginBottom: '4px' }}>
                                        {looseLootStats.shown} items shown / {looseLootStats.total} total ({looseLootStats.ground} ground, {looseLootStats.container} container)
                                    </div>

                                    {showLooseLoot && looseLootData.length > 0 && (
                                        <div style={{ maxHeight: '300px', overflowY: 'auto', borderTop: '1px solid rgba(154,136,102,0.2)', paddingTop: '4px' }}>
                                            {[...looseLootData]
                                                .filter(item => {
                                                    if (item.itemId && pickedUpItemIds.has(item.itemId)) return false
                                                    const tp = item.price * item.qty
                                                    if (tp < looseLootMinPrice) return false
                                                    const isC = item.inContainer === true || item.inContainer === 1
                                                    if (looseLootFilter === 'ground' && isC) return false
                                                    if (looseLootFilter === 'container' && !isC) return false
                                                    return true
                                                })
                                                .sort((a, b) => (b.price * b.qty) - (a.price * a.qty))
                                                .slice(0, 100)
                                                .map((item, idx) => {
                                                    const isC = item.inContainer === true || (item.inContainer as any) === 1
                                                    const tp = item.price * item.qty
                                                    return (
                                                        <div
                                                            key={idx}
                                                            className="flex items-center"
                                                            style={{ padding: '1px 0', fontSize: '12px', gap: '4px', cursor: 'pointer' }}
                                                            onMouseEnter={() => highlightLooseLootItem(item)}
                                                            onMouseLeave={() => highlightLooseLootItem(null)}
                                                        >
                                                            <span style={{ color: getLootPriceColor(tp), fontSize: '9px', flexShrink: 0 }}>{isC ? '\u25A0' : '\u25C6'}</span>
                                                            <span style={{ color: getLootPriceColor(tp), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                                                                {item.itemName}
                                                            </span>
                                                            <span style={{ opacity: 0.7, flexShrink: 0 }}>
                                                                {item.qty > 1 ? `x${item.qty} ` : ''}{'\u20BD'}{tp.toLocaleString()}
                                                            </span>
                                                        </div>
                                                    )
                                                })
                                            }
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* ── Bot Quests Section (QuestingBots) ── */}
                        {botQuestData.length > 0 && (
                            <div className="mt-4" style={{ borderTop: '1px solid rgba(154, 136, 102, 0.3)', paddingTop: '8px' }}>
                                <div
                                    className="flex items-center cursor-pointer"
                                    style={{ fontSize: '14px' }}
                                    onClick={() => setBotQuestCollapsed(!botQuestCollapsed)}
                                >
                                    <span style={{ marginRight: '4px', fontSize: '9px' }}>{botQuestCollapsed ? '\u25B6' : '\u25BC'}</span>
                                    <strong>Bot Quests</strong>
                                </div>
                                {!botQuestCollapsed && (
                                    <div style={{ marginTop: '6px', fontSize: '13px' }}>
                                        <label className="flex items-center gap-2 cursor-pointer" style={{ marginBottom: '6px' }}>
                                            <input
                                                type="checkbox"
                                                checked={showBotQuests}
                                                onChange={() => setShowBotQuests(!showBotQuests)}
                                                style={{ accentColor: '#9a8866' }}
                                            />
                                            <span>Show on map</span>
                                        </label>
                                        <div style={{ fontSize: '11px', opacity: 0.7, marginBottom: '4px' }}>
                                            {botQuestData.length} quest events recorded
                                        </div>
                                        <div style={{ fontSize: '11px', marginBottom: '4px' }}>
                                            <span style={{ color: '#FBCFE8', marginRight: '8px' }}>{'\u25CF'} EFT Quest</span>
                                            <span style={{ color: '#D946EF' }}>{'\u25CF'} QB Quest</span>
                                        </div>
                                        <div style={{ maxHeight: '250px', overflowY: 'auto', borderTop: '1px solid rgba(154,136,102,0.2)', paddingTop: '4px' }}>
                                            {(() => {
                                                // Show latest quest per bot at current timeline
                                                const latestByBot: Record<string, any> = {}
                                                for (const q of botQuestData) {
                                                    if (Number(q.time) > timeEndLimit) continue
                                                    const prev = latestByBot[q.profileId]
                                                    if (!prev || Number(q.time) > Number(prev.time)) latestByBot[q.profileId] = q
                                                }
                                                // Build dead bot set at current time
                                                const deadOrGone = new Set<string>()
                                                if (raidData?.kills) {
                                                    for (const k of raidData.kills) {
                                                        if (Number(k.time) <= timeEndLimit) deadOrGone.add(k.killedId)
                                                    }
                                                }
                                                return Object.entries(latestByBot)
                                                    .filter(([profileId, q]) => q.status !== 'Completed' && q.status !== 'Archived' && q.status !== 'Failed' && !deadOrGone.has(profileId))
                                                    .map(([profileId, q]) => {
                                                        const player = raidData?.players?.find(p => p.profileId === profileId)
                                                        const botName = player?.name || profileId.slice(0, 8)
                                                        const isEFT = q.isEFTQuest === 1 || q.isEFTQuest === true
                                                        return (
                                                            <div key={profileId} style={{ padding: '2px 0', borderBottom: '1px solid rgba(154,136,102,0.1)' }}>
                                                                <div style={{ fontSize: '12px' }}>
                                                                    <strong>{botName}</strong>
                                                                    <span style={{ color: isEFT ? '#FBCFE8' : '#D946EF', marginLeft: '4px', fontSize: '10px' }}>
                                                                        {isEFT ? 'EFT' : 'QB'}
                                                                    </span>
                                                                </div>
                                                                <div style={{ fontSize: '11px', opacity: 0.7 }}>
                                                                    {q.questName} — {q.actionType}
                                                                </div>
                                                            </div>
                                                        )
                                                    })
                                            })()}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ── Bot Objectives Section (Phobos) ── */}
                        {botObjectiveData.length > 0 && (
                            <div className="mt-4" style={{ borderTop: '1px solid rgba(154, 136, 102, 0.3)', paddingTop: '8px' }}>
                                <div
                                    className="flex items-center cursor-pointer"
                                    style={{ fontSize: '14px' }}
                                    onClick={() => setBotObjectiveCollapsed(!botObjectiveCollapsed)}
                                >
                                    <span style={{ marginRight: '4px', fontSize: '9px' }}>{botObjectiveCollapsed ? '▶' : '▼'}</span>
                                    <strong>Bot Objectives</strong>
                                </div>
                                {!botObjectiveCollapsed && (
                                    <div style={{ marginTop: '6px', fontSize: '13px' }}>
                                        <label className="flex items-center gap-2 cursor-pointer" style={{ marginBottom: '6px' }}>
                                            <input
                                                type="checkbox"
                                                checked={showBotObjectives}
                                                onChange={() => setShowBotObjectives(!showBotObjectives)}
                                                style={{ accentColor: '#9a8866' }}
                                            />
                                            <span>Show on map</span>
                                        </label>
                                        <div style={{ fontSize: '11px', opacity: 0.7, marginBottom: '4px' }}>
                                            {botObjectiveData.length} objective events recorded (Phobos)
                                        </div>
                                        <div style={{ fontSize: '11px', marginBottom: '4px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                            <span style={{ color: '#FACC15' }}>{'●'} Container</span>
                                            <span style={{ color: '#FBBF24' }}>{'●'} Loose Loot</span>
                                            <span style={{ color: '#D946EF' }}>{'●'} Quest</span>
                                            <span style={{ color: '#38BDF8' }}>{'●'} Synthetic</span>
                                            <span style={{ color: '#2DD4BF' }}>{'●'} Exfil</span>
                                        </div>
                                        <div style={{ maxHeight: '250px', overflowY: 'auto', borderTop: '1px solid rgba(154,136,102,0.2)', paddingTop: '4px' }}>
                                            {(() => {
                                                const latestByBot: Record<string, any> = {}
                                                for (const o of botObjectiveData) {
                                                    if (Number(o.time) > timeEndLimit) continue
                                                    const prev = latestByBot[o.profileId]
                                                    if (!prev || Number(o.time) > Number(prev.time)) latestByBot[o.profileId] = o
                                                }
                                                const deadOrGone = new Set<string>()
                                                if (raidData?.kills) {
                                                    for (const k of raidData.kills) {
                                                        if (Number(k.time) <= timeEndLimit) deadOrGone.add(k.killedId)
                                                    }
                                                }
                                                const catColor: Record<string, string> = {
                                                    'ContainerLoot': '#FACC15', 'LooseLoot': '#FBBF24',
                                                    'Quest': '#D946EF', 'Synthetic': '#38BDF8', 'Exfil': '#2DD4BF',
                                                }
                                                return Object.entries(latestByBot)
                                                    .filter(([profileId, o]) => o.status === 'Moving' && !deadOrGone.has(profileId))
                                                    .map(([profileId, o]) => {
                                                        const player = raidData?.players?.find(p => p.profileId === profileId)
                                                        const botName = player?.name || profileId.slice(0, 8)
                                                        const isLeader = o.isLeader === 1 || o.isLeader === true
                                                        return (
                                                            <div key={profileId} style={{ padding: '2px 0', borderBottom: '1px solid rgba(154,136,102,0.1)' }}>
                                                                <div style={{ fontSize: '12px' }}>
                                                                    <strong>{botName}</strong>{isLeader ? ' ★' : ''}
                                                                    <span style={{ color: catColor[o.category] || '#94A3B8', marginLeft: '4px', fontSize: '10px' }}>
                                                                        {o.category || 'Objective'}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        )
                                                    })
                                            })()}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ── Phobos Advection Field Section ── */}
                        {phobosFieldData.length > 0 && (
                            <div className="mt-4" style={{ borderTop: '1px solid rgba(154, 136, 102, 0.3)', paddingTop: '8px' }}>
                                <div
                                    className="flex items-center cursor-pointer"
                                    style={{ fontSize: '14px' }}
                                    onClick={() => setPhobosFieldCollapsed(!phobosFieldCollapsed)}
                                >
                                    <span style={{ marginRight: '4px', fontSize: '9px' }}>{phobosFieldCollapsed ? '▶' : '▼'}</span>
                                    <strong>Phobos Field</strong>
                                </div>
                                {!phobosFieldCollapsed && (
                                    <div style={{ marginTop: '6px', fontSize: '13px' }}>
                                        <label className="flex items-center gap-2 cursor-pointer" style={{ marginBottom: '6px' }}>
                                            <input
                                                type="checkbox"
                                                checked={showPhobosField}
                                                onChange={() => setShowPhobosField(!showPhobosField)}
                                                style={{ accentColor: '#9a8866' }}
                                            />
                                            <span>Show on map</span>
                                        </label>
                                        <div style={{ fontSize: '11px', opacity: 0.7, marginBottom: '4px' }}>
                                            {phobosFieldData.length} field snapshots recorded
                                        </div>
                                        <div style={{ marginLeft: '4px', opacity: showPhobosField ? 1 : 0.4, pointerEvents: showPhobosField ? 'auto' : 'none' }}>
                                            <label className="flex items-center gap-2 cursor-pointer" style={{ marginBottom: '4px', fontSize: '12px' }}>
                                                <input
                                                    type="checkbox"
                                                    checked={showPhobosAdvection}
                                                    onChange={() => setShowPhobosAdvection(!showPhobosAdvection)}
                                                    style={{ accentColor: '#F59E0B' }}
                                                />
                                                <span style={{ color: '#F59E0B' }}>{'➜'} Advection (zones)</span>
                                            </label>
                                            {/* Convergence toggle is hidden for ORBIT raids (always-empty convergence). Surface only when a v1 snapshot carries data. */}
                                            {phobosFieldData.some((s: any) => Array.isArray(s.convergence) && s.convergence.length > 0) && (
                                                <label className="flex items-center gap-2 cursor-pointer" style={{ marginBottom: '4px', fontSize: '12px' }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={showPhobosConvergence}
                                                        onChange={() => setShowPhobosConvergence(!showPhobosConvergence)}
                                                        style={{ accentColor: '#22D3EE' }}
                                                    />
                                                    <span style={{ color: '#22D3EE' }}>{'➜'} Convergence (players)</span>
                                                </label>
                                            )}
                                            <label className="flex items-center gap-2 cursor-pointer" style={{ marginBottom: '4px', fontSize: '12px' }}>
                                                <input
                                                    type="checkbox"
                                                    checked={showPhobosZones}
                                                    onChange={() => setShowPhobosZones(!showPhobosZones)}
                                                    style={{ accentColor: '#9a8866' }}
                                                />
                                                <span><span style={{ color: '#22C55E' }}>{'◯'}</span>/<span style={{ color: '#EF4444' }}>{'◯'}</span> Zones (attractor/repulsor)</span>
                                            </label>
                                        </div>
                                        <div style={{ fontSize: '10px', opacity: 0.6, marginTop: '4px' }}>
                                            Field shown is the snapshot closest to the current timeline position.
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ── ORBIT Main Objectives (click bot to view) ── */}
                        {orbitMainObjectivesData.length > 0 && (
                            <div className="mt-4" style={{ borderTop: '1px solid rgba(154, 136, 102, 0.3)', paddingTop: '8px' }}>
                                <div style={{ fontSize: '14px', marginBottom: '6px' }}>
                                    <strong>ORBIT Main Objectives</strong>
                                    {selectedSquadForMains != null && (() => {
                                        // Resolve the selected squad's leader (assumed first
                                        // member in memberProfileIds — that's how
                                        // ORBIT.cs serialises Squad.Members and the
                                        // leader is the first agent added). Render their
                                        // colour dot + nickname instead of an opaque
                                        // squad number.
                                        const sq = findLatestSquadEntry(selectedSquadForMains, timeEndLimit)
                                        const leaderPid = sq?.memberProfileIds?.[0]
                                        const leaderIdx = leaderPid ? raidData.players.findIndex((p: any) => p.profileId === leaderPid) : -1
                                        const leaderPlayer = leaderIdx >= 0 ? raidData.players[leaderIdx] : null
                                        const leaderColor = leaderPlayer
                                            ? (calculatedPlayerInfo[leaderPid!]?.pickedColor || getPlayerColor(leaderPlayer, leaderIdx))
                                            : '#999'
                                        const leaderName = leaderPlayer?.name || `Squad #${selectedSquadForMains}`
                                        return (
                                            <span style={{ marginLeft: '8px', fontSize: '12px', opacity: 0.9 }}>
                                                <span style={{ color: leaderColor, fontSize: '14px', verticalAlign: 'middle' }}>●</span>{' '}
                                                <span style={{ verticalAlign: 'middle' }}>{leaderName}</span>{' '}
                                                <button
                                                    onClick={() => setSelectedSquadForMains(null)}
                                                    style={{ marginLeft: '4px', fontSize: '10px', padding: '1px 4px', background: 'rgba(154,136,102,0.3)', border: 'none', cursor: 'pointer' }}
                                                >hide</button>
                                            </span>
                                        )
                                    })()}
                                </div>
                                <div style={{ fontSize: '11px', opacity: 0.7, marginBottom: '4px' }}>
                                    {selectedSquadForMains == null
                                        ? 'Click any bot dot on the map to show their squad\'s main objectives sequence.'
                                        : 'Click another bot to switch squad, click the same bot again to hide.'}
                                </div>
                                <div style={{ fontSize: '11px', marginBottom: '4px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                    <span style={{ color: '#EF4444' }}>{'●'} Kills</span>
                                    <span style={{ color: '#F59E0B' }}>{'●'} LootValue</span>
                                    <span style={{ color: '#A855F7' }}>{'●'} Quest</span>
                                    <span style={{ color: '#6B7280' }}>{'●'} Completed</span>
                                </div>
                                {/* Per-squad mains list — only when a squad is selected. Each
                                    row shows the type + per-type detail (quest name, loot
                                    value in roubles, Kills roam-target duration). */}
                                {selectedSquadForMains != null && (() => {
                                    const sq = findLatestSquadEntry(selectedSquadForMains, timeEndLimit)
                                    if (!sq || !sq.mainObjectives) return null
                                    const colorByType: Record<string, string> = { Kills: '#EF4444', LootValue: '#F59E0B', Quest: '#A855F7' }
                                    return (
                                        <div style={{ marginTop: '6px', borderTop: '1px dashed rgba(154,136,102,0.3)', paddingTop: '6px' }}>
                                            {sq.mainObjectives.map((m: any, idx: number) => {
                                                const baseColor = colorByType[m.type] || '#888'
                                                const isStarted = !m.completed && (
                                                    (m.type === 'Kills' && m.killsRoamStartedAt > 0) ||
                                                    (m.type === 'LootValue' && m.lootValueEnteredAt > 0)
                                                )
                                                const isInterrupted = isStarted && m.type === 'LootValue' && m.lootValueInterrupted === true
                                                const stateGlyph = m.completed ? '✓' : (isInterrupted ? '⏸' : (isStarted ? '◉' : '○'))
                                                const stateColor = m.completed ? '#6B7280' : (isInterrupted ? '#F59E0B' : (isStarted ? '#fff' : baseColor))
                                                let detail = ''
                                                if (m.type === 'Quest') {
                                                    const friendly = resolveQuestName(m.questTriggerId || m.questTitle, questNameMap)
                                                    detail = friendly || m.questTitle || m.questTriggerId || '(no title)'
                                                } else if (m.type === 'LootValue') {
                                                    detail = m.lootValueTotal > 0
                                                        ? `₽ ${Math.round(m.lootValueTotal).toLocaleString()}`
                                                        : '(no value)'
                                                } else if (m.type === 'Kills') {
                                                    detail = `${Math.round(m.killsRoamTargetDuration || 0)}s in zone`
                                                }
                                                return (
                                                    <div
                                                        key={idx}
                                                        style={{
                                                            display: 'flex', alignItems: 'center', gap: '6px',
                                                            padding: '2px 4px', fontSize: '11px',
                                                            opacity: m.completed ? 0.5 : 1,
                                                            textDecoration: m.completed ? 'line-through' : 'none',
                                                            cursor: 'pointer',
                                                            borderRadius: '2px',
                                                        }}
                                                        onMouseEnter={(ev) => {
                                                            // Highlight the matching marker on the
                                                            // map: open its tooltip so the user
                                                            // can see exactly where the main is.
                                                            const marker = orbitMainObjectiveMarkersRef.current[idx]
                                                            marker?.openTooltip()
                                                            ;(ev.currentTarget as HTMLDivElement).style.background = 'rgba(154,136,102,0.18)'
                                                        }}
                                                        onMouseLeave={(ev) => {
                                                            const marker = orbitMainObjectiveMarkersRef.current[idx]
                                                            marker?.closeTooltip()
                                                            ;(ev.currentTarget as HTMLDivElement).style.background = 'transparent'
                                                        }}
                                                    >
                                                        <span style={{ color: stateColor, fontWeight: 'bold' }}>{stateGlyph}</span>
                                                        <span style={{ color: baseColor, minWidth: '64px' }}>{m.type}</span>
                                                        <span style={{ opacity: 0.85 }}>{detail}</span>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    )
                                })()}
                            </div>
                        )}

                        {/* ── Bot Inventory Section ── */}
                        {botsWithInventory.length > 0 && (
                            <div className="mt-4" style={{ borderTop: '1px solid rgba(154, 136, 102, 0.3)', paddingTop: '8px' }}>
                                <div
                                    className="flex items-center cursor-pointer"
                                    style={{ fontSize: '14px' }}
                                    onClick={() => setBotInvCollapsed(!botInvCollapsed)}
                                >
                                    <span style={{ marginRight: '4px', fontSize: '9px' }}>{botInvCollapsed ? '\u25B6' : '\u25BC'}</span>
                                    <strong>Bot Inventory</strong>
                                </div>
                                {!botInvCollapsed && (
                                    <div style={{ marginTop: '6px', fontSize: '13px' }}>
                                        {/* Bot selector with colored dots */}
                                        <div style={{ maxHeight: '180px', overflowY: 'auto', border: '1px solid rgba(154,136,102,0.4)', marginBottom: '6px', background: '#111' }}>
                                            {botsWithInventory.map(bot => {
                                                const bIdx = raidData.players?.indexOf(bot) ?? 0
                                                const bColor = getPlayerColor(bot, bIdx)
                                                const isSelected = bot.profileId === selectedBotProfileId
                                                return (
                                                    <div
                                                        key={bot.profileId}
                                                        onClick={() => setSelectedBotProfileId(isSelected ? '' : bot.profileId)}
                                                        className="flex items-center cursor-pointer"
                                                        style={{
                                                            padding: '3px 6px', fontSize: '12px',
                                                            background: isSelected ? 'rgba(154,136,102,0.25)' : 'transparent',
                                                            borderLeft: isSelected ? '2px solid #9a8866' : '2px solid transparent',
                                                        }}
                                                    >
                                                        <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: bColor, marginRight: '5px', flexShrink: 0 }} />
                                                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                            {getDisplayName(bot)}
                                                        </span>
                                                        {botSpawnValues[bot.profileId] > 0 && (
                                                            <span style={{ marginLeft: 'auto', paddingLeft: '4px', opacity: 0.6, flexShrink: 0 }}>
                                                                {'\u20BD'}{formatCompactNumber(botSpawnValues[bot.profileId])}
                                                            </span>
                                                        )}
                                                    </div>
                                                )
                                            })}
                                        </div>

                                        {selectedBotProfileId && selectedBotInventory.slots.length > 0 && (
                                            <div style={{ maxHeight: 'calc(100vh - 400px)', overflowY: 'auto' }}>
                                                {selectedBotInventory.slots.map((group) => {
                                                    const isSlotCollapsed = collapsedSlots[group.name] ?? false
                                                    const attKey = `${group.name}__att`
                                                    const isAttCollapsed = collapsedSlots[attKey] ?? true
                                                    return (
                                                        <div key={group.name} style={{ marginBottom: '4px' }}>
                                                            {/* Slot header */}
                                                            <div
                                                                className="flex items-center justify-between cursor-pointer"
                                                                onClick={() => toggleSlotCollapse(group.name)}
                                                                style={{ fontSize: '13px', fontWeight: 'bold', opacity: 0.9, borderBottom: '1px solid rgba(154,136,102,0.2)', marginBottom: '2px', paddingBottom: '2px', userSelect: 'none' }}
                                                            >
                                                                <span>
                                                                    <span style={{ fontSize: '9px', marginRight: '3px' }}>{isSlotCollapsed ? '\u25B6' : '\u25BC'}</span>
                                                                    {group.name} <span style={{ fontWeight: 'normal', opacity: 0.6 }}>({group.items.length})</span>
                                                                </span>
                                                                {!NON_LOOTABLE_SLOTS.test(group.name) && <span style={{ fontWeight: 'normal', opacity: 0.6, fontSize: '12px' }}>{'\u20BD'}{group.total.toLocaleString()}</span>}
                                                            </div>
                                                            {/* Slot items */}
                                                            {!isSlotCollapsed && group.items.map((item, idx) => (
                                                                <div key={idx} className="flex justify-between" style={{ padding: '1px 0 1px 10px', fontSize: '12px' }}>
                                                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>
                                                                        {item.itemName}
                                                                    </span>
                                                                    <span style={{ opacity: 0.7 }}>
                                                                        {item.qty > 1 ? `x${item.qty} ` : ''}{!NON_LOOTABLE_SLOTS.test(group.name) && <>{'\u20BD'}{(item.price * item.qty).toLocaleString()}</>}
                                                                    </span>
                                                                </div>
                                                            ))}
                                                            {/* Weapon attachments sub-group */}
                                                            {!isSlotCollapsed && group.attachments && group.attachments.items.length > 0 && (
                                                                <div style={{ marginTop: '2px', marginLeft: '10px' }}>
                                                                    <div
                                                                        className="flex items-center justify-between cursor-pointer"
                                                                        onClick={() => toggleSlotCollapse(attKey)}
                                                                        style={{ fontSize: '12px', fontWeight: 'bold', opacity: 0.7, marginBottom: '2px', userSelect: 'none' }}
                                                                    >
                                                                        <span>
                                                                            <span style={{ fontSize: '8px', marginRight: '3px' }}>{isAttCollapsed ? '\u25B6' : '\u25BC'}</span>
                                                                            {group.attachments.name} parts <span style={{ fontWeight: 'normal' }}>({group.attachments.items.length})</span>
                                                                        </span>
                                                                        <span style={{ fontWeight: 'normal', fontSize: '11px' }}>{'\u20BD'}{group.attachments.total.toLocaleString()}</span>
                                                                    </div>
                                                                    {!isAttCollapsed && group.attachments.items.map((item, idx) => (
                                                                        <div key={idx} className="flex justify-between" style={{ padding: '1px 0 1px 10px', fontSize: '11px', opacity: 0.8 }}>
                                                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '55%' }}>
                                                                                {item.itemName}
                                                                            </span>
                                                                            <span style={{ opacity: 0.6 }}>
                                                                                {item.qty > 1 ? `x${item.qty} ` : ''}{'\u20BD'}{(item.price * item.qty).toLocaleString()}
                                                                            </span>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}
                                                            {/* Other sub-groups (helmet, armor, plates, pockets) */}
                                                            {!isSlotCollapsed && group.subGroups && group.subGroups.map(sg => {
                                                                const sgKey = `${group.name}__${sg.name}`
                                                                const isSgCollapsed = collapsedSlots[sgKey] ?? true
                                                                return (
                                                                    <div key={sg.name} style={{ marginTop: '2px', marginLeft: '10px' }}>
                                                                        <div
                                                                            className="flex items-center justify-between cursor-pointer"
                                                                            onClick={() => toggleSlotCollapse(sgKey)}
                                                                            style={{ fontSize: '12px', fontWeight: 'bold', opacity: 0.7, marginBottom: '2px', userSelect: 'none' }}
                                                                        >
                                                                            <span>
                                                                                <span style={{ fontSize: '8px', marginRight: '3px' }}>{isSgCollapsed ? '\u25B6' : '\u25BC'}</span>
                                                                                {sg.name} <span style={{ fontWeight: 'normal' }}>({sg.items.length})</span>
                                                                            </span>
                                                                            <span style={{ fontWeight: 'normal', fontSize: '11px' }}>{'\u20BD'}{sg.total.toLocaleString()}</span>
                                                                        </div>
                                                                        {!isSgCollapsed && sg.items.map((item, idx) => (
                                                                            <div key={idx} className="flex justify-between" style={{ padding: '1px 0 1px 10px', fontSize: '11px', opacity: 0.8 }}>
                                                                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '55%' }}>
                                                                                    {item.itemName}
                                                                                </span>
                                                                                <span style={{ opacity: 0.6 }}>
                                                                                    {item.qty > 1 ? `x${item.qty} ` : ''}{'\u20BD'}{(item.price * item.qty).toLocaleString()}
                                                                                </span>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                )
                                                            })}
                                                        </div>
                                                    )
                                                })}
                                                <div style={{ borderTop: '1px solid rgba(154,136,102,0.3)', paddingTop: '4px', marginTop: '4px', fontWeight: 'bold', fontSize: '13px' }}>
                                                    Total: {'\u20BD'}{selectedBotInventory.total.toLocaleString()}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </aside>
                <div className="dev__time_sliders p-3 border border-eft mt-4 timeline">
                    <PlayerSlider
                        events={hideEvents ? [] : events}
                        sliderTimes={sliderTimes}
                        timeCurrentIndex={timeCurrentIndex}
                        setTimeCurrentIndex={setTimeCurrentIndex}
                        setTimeStartLimit={setTimeStartLimit}
                        setTimeEndLimit={setTimeEndLimit}
                        preserveHistory={preserveHistory}
                        playerFocus={playerFocus}
                    />
                    <div className="text-eft mb-2 flex justify-between">
                        <span>{msToHMS(timeEndLimit)}</span>
                        <span className={`${hideNerdStats ? 'invisible' : ''}`}>
                            {((timeCurrentIndex / sliderTimes.length) * 100).toFixed(0)}% | 24fps · {playbackSpeed}x | Frame: {timeCurrentIndex} / {sliderTimes.length - 1} | Cut In/Out (ms): {timeStartLimit} / {timeEndLimit}
                        </span>
                        <span>{msToHMS(sliderTimes.length > 0 ? sliderTimes[sliderTimes.length - 1] : 0)}</span>
                    </div>
                    <div className="flex gap-1">
                        <button className={`text-sm p-2 py-1 text-sm ${playing ? 'bg-eft text-black ' : 'cursor-pointer text-eft'} border border-eft`} onClick={() => playPositions()}>
                            {playing ? '⏸️' : '▶️'}
                        </button>
                        <button className={`text-sm p-2 py-1 text-sm ${!playing ? 'bg-eft text-black ' : 'cursor-pointer text-eft'} border border-eft`} onClick={() => setPlaying(false)}>
                            ⏹️
                        </button>
                        <button className={`text-sm p-2 py-1 text-sm ${playbackSpeed === 1 ? 'bg-eft text-black ' : 'cursor-pointer text-eft'} border border-eft`} onClick={() => setPlaybackSpeed(1)}>
                            1x
                        </button>
                        <button className={`text-sm p-2 py-1 text-sm ${playbackSpeed === 2 ? 'bg-eft text-black ' : 'cursor-pointer text-eft'} border border-eft`} onClick={() => setPlaybackSpeed(2)}>
                            2x
                        </button>
                        <button className={`text-sm p-2 py-1 text-sm ${playbackSpeed === 4 ? 'bg-eft text-black ' : 'cursor-pointer text-eft'} border border-eft`} onClick={() => setPlaybackSpeed(4)}>
                            4x
                        </button>
                        <button className={`text-sm p-2 py-1 text-sm ${playbackSpeed === 8 ? 'bg-eft text-black ' : 'cursor-pointer text-eft'} border border-eft`} onClick={() => setPlaybackSpeed(8)}>
                            8x
                        </button>
                        <button className={`text-sm p-2 py-1 mr-4 text-sm ${playbackSpeed === 16 ? 'bg-eft text-black ' : 'cursor-pointer text-eft'} border border-eft`} onClick={() => setPlaybackSpeed(16)}>
                            16x
                        </button>
                        <button className={`text-sm p-2 py-1 text-sm ${!hideSettings ? 'bg-eft text-black ' : 'cursor-pointer text-eft'} border border-eft`} onClick={() => setHideSettings(!hideSettings)}>
                            ⚙️
                        </button>
                        <div className={`border border-eft p-1 flex gap-1 ${hideSettings ? 'invisible' : ''}`}>
                            <button className={`text-xs p-1 text-sm cursor-pointer ${hidePlayers ? 'bg-eft text-black ' : 'cursor-pointer text-eft'} border border-eft`} onClick={() => setHidePlayers(!hidePlayers)}>
                                Hide Players
                            </button>
                            <button className={`text-xs p-1 text-sm cursor-pointer ${hideEvents ? 'bg-eft text-black ' : 'cursor-pointer text-eft'} border border-eft`} onClick={() => setHideEvents(!hideEvents)}>
                                Hide Events
                            </button>
                            <button className={`text-xs p-1 text-sm cursor-pointer ${hideBallistics ? 'bg-eft text-black ' : 'cursor-pointer text-eft'} border border-eft`} onClick={() => setHideBallistics(!hideBallistics)}>
                                Hide Ballistics
                            </button>
                            <button className={`text-xs p-1 text-sm cursor-pointer ${preserveHistory ? 'bg-eft text-black ' : 'cursor-pointer text-eft'} border border-eft tooltip info`} onClick={() => setPreserveHistory(!preserveHistory)}>
                                Preserve
                                <span className="tooltiptext info">If enabled, keeps all activity visible throughout playback, otherwise, only recent activity is kept visible.</span>
                            </button>
                            <button className={`text-xs p-1 text-sm cursor-pointer ${!hideNerdStats ? 'bg-eft text-black ' : 'cursor-pointer text-eft'} border border-eft`} onClick={() => setHideNerdStats(!hideNerdStats)}>
                                Debug
                            </button>
                            <button className={`text-xs p-1 text-sm cursor-pointer ${showBehavior ? 'bg-eft text-black ' : 'cursor-pointer text-eft'} border border-eft`} onClick={() => setShowBehavior(!showBehavior)}>
                                Behavior
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}