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
import { TrackingPositionalData } from '../types/api_types.js';
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
                        behaviorLine = behaviorCat ? `<br/><span style="color:${behaviorCat.color}">${behaviorCat.label}</span>: ${formatDecisionLabel(currentDecision)}` : ''
                    }
                    const tip = `${getDisplayName(player)} (${getPlayerDifficultyAndBrain(player)})${behaviorLine}`
                    const marker = createPlayerMarker(endOfLine, pickedColor, player, proportionalScale, markerOpacity, pmcIndexMap[playerId], tip, behaviorCat?.color)
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

    // Ballistics Update
    let ballisticsLayers = new Map();
    useEffect(() => {
        if (hideBallistics) return;
        if (!mapIsReady || !MAP) return;

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

                let hit = !!ballistic.hitPlayerId;
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

                    if (MAP) {
                        polyline.addTo(MAP);
                    }

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

    function clearMap(m, timeRange) {
        if (!m || !mapIsReady) return;
    
        for (const key in m._layers) {
            const layer = m._layers[key];
        
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
                            <strong style={{ fontSize: '12px' }}>Bot Behavior</strong>
                            <div style={{ marginTop: '4px' }}>
                                {Object.values(BEHAVIOR_CATEGORIES).map(cat => (
                                    <div key={cat.key} className="flex items-center" style={{ padding: '1px 0', fontSize: '11px' }}>
                                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: cat.color, marginRight: 6, flexShrink: 0, display: 'inline-block', boxShadow: `0 0 4px ${cat.color}` }}></span>
                                        <span>{cat.label}</span>
                                    </div>
                                ))}
                            </div>
                            {!raidData?.detectedMods?.match(/SAIN/gi) && (
                                <div style={{ marginTop: '6px', fontSize: '9px', color: '#F59E0B', opacity: 0.7 }}>
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