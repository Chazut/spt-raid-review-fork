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
import { getMarkerLabel, getPlayerColor, getLegendIcon, PMC_COLORS, buildPmcIndexMap } from '../helpers/players'
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
        case 'BLACKDIV': return 'FACTION'
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

function createPlayerMarker(latlng: any, color: string, player: any, proportionalScale: number, opacity: number = 1, pmcIndex?: number, tooltipText?: string, behaviorColor?: string | null): L.Layer {
    const displayName = tooltipText || getDisplayName(player)
    const tooltipOpts: L.TooltipOptions = { direction: 'top', offset: [0, -10], className: 'player-tooltip' }
    const ringStyle = behaviorColor ? `box-shadow: 0 0 0 3px ${behaviorColor}, 0 0 6px 1px ${behaviorColor}55;` : ''
    const label = getMarkerLabel(player)
    if (label === 'BTR_ICON') {
        const btrSvg = `<svg viewBox="0 0 24 18" width="24" height="18" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="3" width="20" height="8" rx="1" fill="${color}" opacity="${opacity}"/><rect x="5" y="1" width="10" height="4" rx="1" fill="${color}" opacity="${opacity}"/><line x1="15" y1="3" x2="20" y2="5" stroke="${color}" stroke-width="1.2" opacity="${opacity}"/><circle cx="5.5" cy="13.5" r="2.5" fill="${color}" opacity="${opacity}"/><circle cx="12" cy="13.5" r="2.5" fill="${color}" opacity="${opacity}"/><circle cx="18.5" cy="13.5" r="2.5" fill="${color}" opacity="${opacity}"/><circle cx="5.5" cy="13.5" r="1" fill="#1a1a1a"/><circle cx="12" cy="13.5" r="1" fill="#1a1a1a"/><circle cx="18.5" cy="13.5" r="1" fill="#1a1a1a"/></svg>`
        const icon = L.divIcon({
            className: 'special-bot-marker',
            html: `<div style="display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 0 2px rgba(0,0,0,0.9));${ringStyle}">${btrSvg}</div>`,
            iconSize: [24, 20],
            iconAnchor: [12, 10],
        })
        return L.marker(latlng, { icon, interactive: true }).bindTooltip(displayName, { ...tooltipOpts, className: 'player-tooltip player-tooltip-html' })
    }
    if (label) {
        const icon = L.divIcon({
            className: 'special-bot-marker',
            html: `<div class="bot-marker-dot" style="background-color: ${color}; opacity: ${opacity}; ${ringStyle}">${label}</div>`,
            iconSize: [18, 18],
            iconAnchor: [9, 9],
        })
        return L.marker(latlng, { icon, interactive: true }).bindTooltip(displayName, { ...tooltipOpts, className: 'player-tooltip player-tooltip-html' })
    }
    // PMCs and player scavs get white border + number label
    if (pmcIndex !== undefined) {
        const icon = L.divIcon({
            className: 'special-bot-marker',
            html: `<div class="bot-marker-dot bot-marker-round" style="background-color: ${color}; opacity: ${opacity}; ${ringStyle}">${pmcIndex}</div>`,
            iconSize: [18, 18],
            iconAnchor: [9, 9],
        })
        return L.marker(latlng, { icon, interactive: true }).bindTooltip(displayName, { ...tooltipOpts, className: 'player-tooltip player-tooltip-html' })
    }
    // Scavs: plain circle — use divIcon for behavior ring support
    if (behaviorColor) {
        const size = Math.max(10, proportionalScale * 2)
        const icon = L.divIcon({
            className: 'special-bot-marker',
            html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};opacity:${opacity};${ringStyle}"></div>`,
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2],
        })
        return L.marker(latlng, { icon, interactive: true }).bindTooltip(displayName, { ...tooltipOpts, className: 'player-tooltip player-tooltip-html' })
    }
    return L.circle(latlng, { radius: proportionalScale, color, fillOpacity: opacity, fillRule: 'nonzero', opacity }).bindTooltip(displayName, tooltipOpts)
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
    const [showBotQuests, setShowBotQuests] = useState(true)
    const [botQuestData, setBotQuestData] = useState<any[]>([])
    const [botQuestCollapsed, setBotQuestCollapsed] = useState(true)
    const botQuestLayerRef = useRef<L.LayerGroup | null>(null)

    // Loot float animations
    const [showLootFloats, setShowLootFloats] = useState(true)
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

        // Two-pass rendering: polylines first, then markers (so dots are always on top)
        const deferredMarkers: { layer: L.Layer, playerId: string, followAction?: boolean }[] = []

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
                    // Get latest behavior decision from position data (skip BTR)
                    const isBTR = player?.type?.includes('BTR')
                    let currentDecision: string | undefined
                    let behaviorCat = null
                    let behaviorLine = ''
                    if (showBehavior && !isBTR) {
                        const pp = positions[playerId]
                        if (pp) {
                            for (let di = pp.length - 1; di >= 0; di--) {
                                if (pp[di].time <= timeEndLimit) {
                                    currentDecision = pp[di].decision
                                    break
                                }
                            }
                        }
                        behaviorCat = getBehaviorCategory(currentDecision)
                        behaviorLine = `<br/><span style="color:${behaviorCat.color}">${behaviorCat.label}</span>${currentDecision ? ': ' + formatDecisionLabel(currentDecision) : ''}`
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
                    const tip = `${getDisplayName(player)} (${getPlayerDifficultyAndBrain(player)})${behaviorLine}${lootLine}`
                    const ringColor = behaviorCat && behaviorCat.key !== 'idle' && behaviorCat.key !== 'patrol' ? behaviorCat.color : undefined
                    const marker = createPlayerMarker(endOfLine, pickedColor, player, proportionalScale, markerOpacity, pmcIndexMap[playerId], tip, ringColor)
                    marker._rr_playerId = playerId
                    marker._rr_isDead = false
                    marker._rr_normalOpacity = 1
                    deferredMarkers.push({ layer: marker, playerId })
                    if (followPlayer === playerId) {
                        if (!followPlayerZoomed) {
                            MAP.setZoom(3)
                            setFollowPlayerZoomed(true)
                        }
                        MAP.panTo(endOfLine, 4)
                    }
                }
            }
        }

        // Second pass: add all markers on top of polylines
        for (const { layer, playerId } of deferredMarkers) {
            layer.addTo(MAP)
            layer.on('mouseover', () => {
                if (focusTimeoutRef.current) clearTimeout(focusTimeoutRef.current)
                setPlayerFocus(playerId)
            })
            layer.on('mouseout', () => {
                if (focusTimeoutRef.current) clearTimeout(focusTimeoutRef.current)
                focusTimeoutRef.current = setTimeout(() => setPlayerFocus(null), 100)
            })
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

        // Clean up previous focus layers
        for (const layer of focusLayersRef.current) {
            MAP.removeLayer(layer)
        }
        focusLayersRef.current = []

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

        // Restore any previously modified tooltips, then enrich focused player's dot tooltip
        for (const key in MAP._layers) {
            const layer = MAP._layers[key]
            if (layer._rr_originalTooltip !== undefined) {
                layer.setTooltipContent(layer._rr_originalTooltip)
                layer.closeTooltip()
                delete layer._rr_originalTooltip
            }
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

            // Try to find existing marker for this player (alive players)
            let found = false
            for (const key in MAP._layers) {
                const layer = MAP._layers[key]
                if (layer._rr_playerId === playerFocus && (layer instanceof L.Marker || layer instanceof L.Circle)) {
                    const tooltip = layer.getTooltip()
                    if (tooltip) {
                        layer._rr_originalTooltip = tooltip.getContent()
                        layer.setTooltipContent(buildFeedHtml(layer._rr_originalTooltip))
                        layer.openTooltip()
                    }
                    found = true
                    break
                }
            }

            // Dead player: no marker on map, create a temporary one at death position
            if (!found && death) {
                const player = raidData.players.find(p => p.profileId === playerFocus)
                const playerIdx = player ? raidData.players.indexOf(player) : 0
                const color = player ? getPlayerColor(player, playerIdx) : '#999'
                const displayName = player ? `${getDisplayName(player)} (${getPlayerDifficultyAndBrain(player)})` : 'Unknown'
                const tmpMarker = L.circleMarker([death.target.z, death.target.x], {
                    radius: 6, color, fillColor: color, fillOpacity: 0.8, weight: 1, interactive: false
                }).addTo(MAP)
                tmpMarker.bindTooltip(buildFeedHtml(displayName), { direction: 'top', offset: [0, -10], className: 'player-tooltip' })
                tmpMarker.openTooltip()
                focusLayersRef.current.push(tmpMarker)
            }
        }

        // Add kill visualization if a player is focused
        if (playerFocus && events.length > 0) {
            // Kills made by hovered player (respecting timeline)
            const playerKills = events.filter(e => e.profileId === playerFocus && e.profileId !== e.killedId && e.time < timeEndLimit)
            for (const kill of playerKills) {
                const line = L.polyline(
                    [[kill.source.z, kill.source.x], [kill.target.z, kill.target.x]],
                    { color: 'red', weight: 2, dashArray: [10], dashOffset: 3, opacity: 1, interactive: false }
                ).addTo(MAP)
                focusLayersRef.current.push(line)
                const skullHtml = `<img src="/skull.png" /><span class="tooltiptext event event-map text-sm"><strong>${kill.killedNickname}</strong><br/>${intl([kill.weapon.replace('Name', 'ShortName')], intl_dir)}, ${kill.distance.toFixed(0)}m${kill.bodyPart ? ', ' + kill.bodyPart : ''}</span>`
                const skullIcon = L.divIcon({ className: 'death-icon tooltip event follow-kill-marker', html: skullHtml })
                const marker = L.marker([kill.target.z, kill.target.x], { icon: skullIcon, interactive: false, zIndexOffset: -1000 }).addTo(MAP)
                focusLayersRef.current.push(marker)
            }

            // Death of the hovered player (if dead) — distinct red-ringed skull
            const deathEvent = events.find(e => e.killedId === playerFocus && e.time < timeEndLimit)
            if (deathEvent) {
                const line = L.polyline(
                    [[deathEvent.source.z, deathEvent.source.x], [deathEvent.target.z, deathEvent.target.x]],
                    { color: 'red', weight: 2, dashArray: [10], dashOffset: 3, opacity: 1, interactive: false }
                ).addTo(MAP)
                focusLayersRef.current.push(line)
                const ownDeathHtml = `<div class="own-death-ring"><img src="/skull.png" /></div><span class="tooltiptext event event-map text-sm"><strong>${deathEvent.profileNickname}</strong><br/>killed<br/><strong>${deathEvent.killedNickname}</strong><br/>${intl([deathEvent.weapon.replace('Name', 'ShortName')], intl_dir)}, ${deathEvent.distance.toFixed(0)}m${deathEvent.bodyPart ? ', ' + deathEvent.bodyPart : ''}</span>`
                const ownDeathIcon = L.divIcon({ className: 'death-icon tooltip event follow-kill-marker', html: ownDeathHtml })
                const marker = L.marker([deathEvent.target.z, deathEvent.target.x], { icon: ownDeathIcon, interactive: false, zIndexOffset: -1000 }).addTo(MAP)
                focusLayersRef.current.push(marker)
            }
        }
    }, [playerFocus, MAP, mapIsReady, events, timeEndLimit, intl_dir])

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
            explosionCircle.addTo(MAP)

            // Arc from throw position to explosion
            const arcLine = L.polyline(
                [[ge.throwZ, ge.throwX], [ge.explosionZ, ge.explosionX]],
                { color: '#FF6B35', weight: 2.5, dashArray: '6 4', opacity: 0.8 }
            )
            arcLine.eventTime = ge.throwTime
            arcLine.eventType = 'ballisticsLine'
            arcLine.eventId = grenadeId + '_arc'
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

        const interval = setInterval(() => {
            setTimeCurrentIndex((prevIndex) => {
                // Check if we've reached the end of the sliderTimes
                if (prevIndex >= sliderTimes.length - 1) {
                    clearInterval(interval)
                    setPlaying(false)
                    return prevIndex
                }

                const frame = sliderTimes[prevIndex]
                const startFrame = sliderTimes[Math.max(0, prevIndex - dropOffIndex)]

                if (!preserveHistory && startFrame) {
                    setTimeStartLimit(startFrame)
                }

                if (preserveHistory) {
                    setTimeStartLimit(sliderTimes[0])
                }

                setTimeEndLimit(frame)

                return prevIndex + 1
            })
        }, 1000 / (24 * playbackSpeed))

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

    // Loose Loot: persist settings to localStorage
    useEffect(() => {
        localStorage.setItem('rr_looseLoot_minPrice', String(looseLootMinPrice))
    }, [looseLootMinPrice])
    useEffect(() => {
        localStorage.setItem('rr_looseLoot_filter', looseLootFilter)
    }, [looseLootFilter])

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
    }, [MAP, mapIsReady, showLooseLoot, looseLootData, looseLootMinPrice, looseLootFilter, pickedUpItemIds, raidData?.looting, timeEndLimit])

    // Bot Quests: fetch data lazily when toggled on
    useEffect(() => {
        if (!showBotQuests) return
        if (botQuestData.length > 0) return
        ;(async () => {
            const data = await api.getRaidBotQuests(raidId)
            if (data && data.length > 0) {
                setBotQuestData(data)
            }
        })()
    }, [showBotQuests, raidId])

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
                color: isEFT ? '#FFD700' : '#00BFFF',
                weight: 2,
                fillColor: isEFT ? 'rgba(255,215,0,0.3)' : 'rgba(0,191,255,0.3)',
                fillOpacity: 0.7,
                interactive: true,
            })

            marker.bindTooltip(
                `${icon} <strong>${botName}</strong><br/>${q.questName}<br/><em>${q.actionType}</em> (${q.status})${isEFT ? '<br/><span style="color:#FFD700">EFT Quest</span>' : ''}`,
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
                            { color: isEFT ? '#FFD700' : '#00BFFF', weight: 1, dashArray: '4 4', opacity: 0.5 }
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
    }, [MAP, mapIsReady, showBotQuests, botQuestData, timeEndLimit, raidData?.players, raidData?.kills, positions])

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
            const color = price >= 50000 ? '#FFD700' : price >= 10000 ? '#9a8866' : '#ccc'

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
        
            // Skip layers managed by other overlays (quests, loose loot, etc.)
            if (layer._rr_quest || layer._rr_looseLoot) continue;

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
                botMapping = {
                    type: 'GOON',
                }
            }
            if (!botMapping) {
                botMapping = {
                    type: 'UNKNOWN',
                }
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
                                    const FACTION_LABELS: Record<string, string> = { MERCENARY: 'Mercenary', RUAF: 'RUAF', UNTAR: 'UNTAR', BLACKDIV: 'Black Div' }
                                    const factions: Record<string, { player: any, originalIndex: number }[]> = {}
                                    items.forEach(item => {
                                        const fType = BotMapping[item.player.type]?.type || 'UNKNOWN'
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
                                    <label className="flex items-center gap-2 cursor-pointer" style={{ marginBottom: '6px' }}>
                                        <input
                                            type="checkbox"
                                            checked={showLootFloats}
                                            onChange={() => setShowLootFloats(!showLootFloats)}
                                            style={{ accentColor: '#9a8866' }}
                                        />
                                        <span>Loot animations</span>
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
                                            <span style={{ color: '#FFD700', marginRight: '8px' }}>{'\u25CF'} EFT Quest</span>
                                            <span style={{ color: '#00BFFF' }}>{'\u25CF'} QB Quest</span>
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
                                                return Object.entries(latestByBot)
                                                    .filter(([, q]) => q.status !== 'Completed' && q.status !== 'Archived' && q.status !== 'Failed')
                                                    .map(([profileId, q]) => {
                                                        const player = raidData?.players?.find(p => p.profileId === profileId)
                                                        const botName = player?.name || profileId.slice(0, 8)
                                                        const isEFT = q.isEFTQuest === 1 || q.isEFTQuest === true
                                                        return (
                                                            <div key={profileId} style={{ padding: '2px 0', borderBottom: '1px solid rgba(154,136,102,0.1)' }}>
                                                                <div style={{ fontSize: '12px' }}>
                                                                    <strong>{botName}</strong>
                                                                    <span style={{ color: isEFT ? '#FFD700' : '#00BFFF', marginLeft: '4px', fontSize: '10px' }}>
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
                            {((timeCurrentIndex / sliderTimes.length) * 100).toFixed(0)}% | {24 * playbackSpeed}fps | Frame: {timeCurrentIndex} / {sliderTimes.length - 1} | Cut In/Out (ms): {timeStartLimit} / {timeEndLimit}
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