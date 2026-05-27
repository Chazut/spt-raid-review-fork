import { LoaderFunctionArgs, useLoaderData, useOutletContext } from "react-router-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "../../api/api";
import { TrackingPositionalData, TrackingRaidData } from "../../types/api_types";
import { intl, msToHMS } from "../../helpers";
import { getPlayerColor, getLegendIcon, buildPmcIndexMap } from "../../helpers/players";
import { getBehaviorCategory, BEHAVIOR_CATEGORIES, formatDecisionLabel } from "../../helpers/botBehavior";
import cyr_to_en from '../../assets/cyr_to_en.json';

export async function loader(loaderData: LoaderFunctionArgs) {
    const positions = await api.getRaidPositionalData(loaderData.params.raidId as string) || [];
    return { positions };
}

interface BehaviorSegment {
    category: string
    categoryColor: string
    decision: string
    label: string
    startTime: number
    endTime: number
}

function buildSegments(entries: TrackingPositionalData[]): BehaviorSegment[] {
    const segments: BehaviorSegment[] = []
    let current: BehaviorSegment | null = null

    for (const entry of entries) {
        const decision = (entry as any).decision || ''
        const cat = getBehaviorCategory(decision)

        if (current && current.category === cat.key) {
            current.endTime = Number(entry.time)
        } else {
            if (current) segments.push(current)
            current = {
                category: cat.key,
                categoryColor: cat.color,
                decision,
                label: cat.label,
                startTime: Number(entry.time),
                endTime: Number(entry.time),
            }
        }
    }
    if (current) segments.push(current)
    return segments
}

// CSS pattern for hatched overlays (injected once)
const HATCH_STYLE_ID = 'rr-behavior-hatch-styles'
function ensureHatchStyles() {
    if (document.getElementById(HATCH_STYLE_ID)) return
    const style = document.createElement('style')
    style.id = HATCH_STYLE_ID
    style.textContent = `
        .rr-hatch-dead {
            background: repeating-linear-gradient(
                -45deg,
                transparent,
                transparent 3px,
                rgba(239,68,68,0.25) 3px,
                rgba(239,68,68,0.25) 5px
            ) !important;
        }
        .rr-hatch-prespawn {
            background: repeating-linear-gradient(
                -45deg,
                transparent,
                transparent 3px,
                rgba(154,136,102,0.15) 3px,
                rgba(154,136,102,0.15) 5px
            ) !important;
        }
        .rr-hatch-extracted {
            background: repeating-linear-gradient(
                -45deg,
                transparent,
                transparent 3px,
                rgba(96,165,250,0.30) 3px,
                rgba(96,165,250,0.30) 5px
            ) !important;
        }
    `
    document.head.appendChild(style)
}

export default function RaidBehaviorTimeline() {
    const { positions } = useLoaderData() as { positions: Record<string, TrackingPositionalData[]> };
    const { raid, intl: intl_dir_ot } = useOutletContext() as { raid: TrackingRaidData, intl: { [key: string]: string } };
    const intl_dir: Record<string, string> = useMemo(() => ({ ...intl_dir_ot, ...cyr_to_en }), [intl_dir_ot]);
    const pmcIndexMap = useMemo(() => raid?.players ? buildPmcIndexMap(raid.players) : {}, [raid?.players]);

    const [hoveredSegment, setHoveredSegment] = useState<{ seg: BehaviorSegment, playerName: string, x: number, y: number } | null>(null);

    // Zoom state: viewStart/viewEnd as ms timestamps (null = full range)
    const [viewRange, setViewRange] = useState<{ start: number, end: number } | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Build death time lookup from kills data
    const deathTimes = useMemo(() => {
        const map: Record<string, number> = {}
        if (raid?.kills) {
            for (const k of raid.kills) {
                if (k.killedId && k.time != null) {
                    // Keep earliest death time per player
                    if (!(k.killedId in map) || k.time < map[k.killedId]) {
                        map[k.killedId] = k.time
                    }
                }
            }
        }
        return map
    }, [raid?.kills])

    const data = useMemo(() => {
        if (!positions || !raid?.players) return { players: [] as any[], raidStart: 0, raidEnd: 0 }

        let raidStart = Infinity, raidEnd = 0
        const playerRows: { profileId: string, name: string, player: any, color: string, segments: BehaviorSegment[], pmcIdx?: number, spawnTime: number, deathTime: number | null, extractTime: number | null }[] = []

        for (const p of raid.players) {
            // Skip BTR and human players (only show bots)
            if (p.type?.includes('BTR')) continue
            if (p.type === 'HUMAN') continue
            const entries = positions[p.profileId]
            if (!entries || entries.length === 0) continue

            const segments = buildSegments(entries)
            if (segments.length === 0) continue

            for (const e of entries) {
                const t = Number(e.time)
                if (t < raidStart) raidStart = t
                if (t > raidEnd) raidEnd = t
            }

            const idx = raid.players.indexOf(p)
            // Extract time = bot stopped reporting positions but had no
            // death event. Conservative threshold: last position must
            // be at least 2 s before the latest raid time (so a bot
            // who simply happens to be at the very tail of the data
            // isn't false-flagged as extracted). Raw raidEnd is the
            // max time across ALL bots — if this bot's last sample is
            // significantly earlier, they probably extracted.
            let lastSampleTime = 0
            for (const e of entries) {
                const t = Number(e.time)
                if (t > lastSampleTime) lastSampleTime = t
            }
            const deathTime = deathTimes[p.profileId] ?? null
            let extractTime: number | null = null
            // Compute later once we know raidEnd — push as null for now,
            // patch in the loop below.

            playerRows.push({
                profileId: p.profileId,
                name: intl(p.name, intl_dir),
                player: p,
                color: getPlayerColor(p, idx),
                segments,
                pmcIdx: pmcIndexMap[p.profileId],
                spawnTime: p.spawnTime,
                deathTime,
                extractTime, // patched after raidEnd is finalised
            })
            // Stash the lastSampleTime on the row so we can resolve
            // extractTime after the raidEnd is known.
            ;(playerRows[playerRows.length - 1] as any)._lastSampleTime = lastSampleTime
        }

        // Resolve extract time per row. A bot is considered extracted
        // when it stopped sending positions at least 2 s before raidEnd
        // AND has no death event. The last-sample time becomes the
        // extractTime; the post-extract span is drawn as a blue hash.
        const extractMinGapMs = 2000
        for (const row of playerRows) {
            const lastSample = (row as any)._lastSampleTime as number
            if (row.deathTime != null) continue
            if (lastSample > 0 && lastSample < raidEnd - extractMinGapMs)
            {
                row.extractTime = lastSample
            }
            delete (row as any)._lastSampleTime
        }

        // Sort by team/side, then by name
        const teamOrder: Record<string, number> = { 'Usec': 0, 'Bear': 1, 'Savage': 2 }
        playerRows.sort((a, b) => {
            const aOrder = teamOrder[a.player.team] ?? 3
            const bOrder = teamOrder[b.player.team] ?? 3
            if (aOrder !== bOrder) return aOrder - bOrder
            return a.name.localeCompare(b.name)
        })

        return { players: playerRows, raidStart, raidEnd }
    }, [positions, raid, intl_dir, pmcIndexMap, deathTimes])

    const { players: playerRows, raidStart, raidEnd } = data

    // Effective view range (zoom or full)
    const effectiveStart = viewRange?.start ?? raidStart
    const effectiveEnd = viewRange?.end ?? raidEnd
    const viewDuration = effectiveEnd - effectiveStart || 1

    // Time axis ticks — adapt interval to zoom level
    const ticks: number[] = []
    const durationSec = viewDuration / 1000
    const tickInterval = durationSec <= 60 ? 10000 : durationSec <= 300 ? 30000 : 60000
    const firstTick = Math.ceil(effectiveStart / tickInterval) * tickInterval
    for (let t = firstTick; t <= effectiveEnd; t += tickInterval) {
        ticks.push(t)
    }

    // Ensure hatch CSS exists
    useMemo(() => ensureHatchStyles(), [])

    const resetZoom = useCallback(() => setViewRange(null), [])

    // Scroll-to-zoom: wheel zooms in/out centered on cursor position
    useEffect(() => {
        const el = containerRef.current
        if (!el) return
        const handler = (e: WheelEvent) => {
            // Only zoom if cursor is over the timeline area (not the name column)
            const rect = el.getBoundingClientRect()
            const relX = e.clientX - rect.left
            if (relX < 180) return // over the name column

            e.preventDefault()
            const timelineWidth = rect.width - 180
            const pct = Math.max(0, Math.min(1, (relX - 180) / timelineWidth))

            const curStart = viewRange?.start ?? raidStart
            const curEnd = viewRange?.end ?? raidEnd
            const curDuration = curEnd - curStart
            const cursorTime = curStart + pct * curDuration

            const zoomFactor = e.deltaY > 0 ? 1.3 : 0.7 // scroll down = zoom out, up = zoom in
            const newDuration = curDuration * zoomFactor
            const fullDuration = raidEnd - raidStart

            // Don't zoom beyond full range
            if (newDuration >= fullDuration) {
                setViewRange(null)
                return
            }
            // Don't zoom below 5 seconds
            if (newDuration < 5000) return

            // Keep cursor at same relative position
            let newStart = cursorTime - pct * newDuration
            let newEnd = cursorTime + (1 - pct) * newDuration

            // Clamp to raid bounds
            if (newStart < raidStart) { newEnd += raidStart - newStart; newStart = raidStart }
            if (newEnd > raidEnd) { newStart -= newEnd - raidEnd; newEnd = raidEnd }
            newStart = Math.max(newStart, raidStart)
            newEnd = Math.min(newEnd, raidEnd)

            setViewRange({ start: newStart, end: newEnd })
        }
        el.addEventListener('wheel', handler, { passive: false })
        return () => el.removeEventListener('wheel', handler)
    }, [viewRange, raidStart, raidEnd])

    if (playerRows.length === 0) {
        return (
            <div className="p-4 text-eft text-center opacity-50" style={{ fontSize: '14px' }}>
                No behavior data available. Play a raid with the updated mod to capture bot decisions.
            </div>
        )
    }

    const hasSain = !!raid?.detectedMods?.match(/SAIN/gi)

    return (
        <div ref={containerRef} className="p-4" style={{ overflowX: 'auto' }}>
            {/* SAIN recommendation banner */}
            {!hasSain && (
                <div className="mb-3 px-3 py-2" style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 4, fontSize: '13px', color: '#F59E0B' }}>
                    <strong>SAIN recommended</strong> — Install <a href="https://hub.sp-tarkov.com/files/file/1062-sain-solarint-s-ai-modifications-full-ai-combat-system-replacement/" target="_blank" rel="noreferrer" style={{ color: '#F59E0B', textDecoration: 'underline' }}>SAIN</a> for detailed bot behavior data (Search, StandAndShoot, FirstAid, etc.). Without SAIN, behavior categories are approximate.
                </div>
            )}

            {/* Legend + zoom controls */}
            <div className="flex flex-wrap items-center gap-4 mb-4">
                {Object.values(BEHAVIOR_CATEGORIES).map(cat => (
                    <div key={cat.key} className="flex items-center gap-1" style={{ fontSize: '13px' }}>
                        <span style={{ width: 12, height: 12, borderRadius: 2, background: cat.color, display: 'inline-block' }}></span>
                        <span className="text-eft">{cat.label}</span>
                    </div>
                ))}
                {/* Hatched legend items */}
                <div className="flex items-center gap-1" style={{ fontSize: '13px' }}>
                    <span className="rr-hatch-prespawn" style={{ width: 12, height: 12, borderRadius: 2, display: 'inline-block', border: '1px solid rgba(154,136,102,0.3)' }}></span>
                    <span className="text-eft">Pre-spawn</span>
                </div>
                <div className="flex items-center gap-1" style={{ fontSize: '13px' }}>
                    <span className="rr-hatch-dead" style={{ width: 12, height: 12, borderRadius: 2, display: 'inline-block', border: '1px solid rgba(239,68,68,0.3)' }}></span>
                    <span className="text-eft">Dead</span>
                </div>
                <div className="flex items-center gap-1" style={{ fontSize: '13px' }}>
                    <span className="rr-hatch-extracted" style={{ width: 12, height: 12, borderRadius: 2, display: 'inline-block', border: '1px solid rgba(96,165,250,0.4)' }}></span>
                    <span className="text-eft">Extracted</span>
                </div>
                {viewRange && (
                    <button onClick={resetZoom} className="px-2 py-0.5 text-black bg-eft hover:opacity-75" style={{ fontSize: '12px' }}>
                        Reset Zoom
                    </button>
                )}
            </div>

            {/* Zoom hint */}
            <div style={{ fontSize: '11px', color: '#666', marginBottom: 4 }}>
                Scroll to zoom in/out
            </div>

            {/* Time axis */}
            <div className="flex" style={{ marginBottom: 2 }}>
                <div style={{ width: 180, flexShrink: 0 }}></div>
                <div className="relative flex-1" style={{ height: 16 }}>
                    {ticks.map(t => {
                        const left = ((t - effectiveStart) / viewDuration) * 100
                        if (left < 0 || left > 100) return null
                        return (
                            <span key={t} style={{
                                position: 'absolute', left: `${left}%`, fontSize: '11px',
                                color: '#9a8866', transform: 'translateX(-50%)', whiteSpace: 'nowrap'
                            }}>
                                {msToHMS(t)}
                            </span>
                        )
                    })}
                </div>
            </div>

            {/* Player rows */}
            {playerRows.map(row => {
                // Pre-spawn hatched zone (before first position data)
                const firstDataTime = row.segments.length > 0 ? row.segments[0].startTime : effectiveEnd
                const preSpawnLeft = 0
                const preSpawnWidth = Math.max(0, ((Math.min(firstDataTime, effectiveEnd) - effectiveStart) / viewDuration) * 100)

                // Death hatched zone (after death to end of view)
                const deathTime = row.deathTime
                let deathLeft = 0, deathWidth = 0
                if (deathTime != null && deathTime < effectiveEnd) {
                    deathLeft = Math.max(0, ((deathTime - effectiveStart) / viewDuration) * 100)
                    deathWidth = Math.max(0, 100 - deathLeft)
                }

                // Extract hatched zone (after extract to end of view —
                // blue hash, only for bots that despawned cleanly via
                // an exfil; mutually exclusive with death since the
                // detection requires no death event).
                const extractTime = row.extractTime
                let extractLeft = 0, extractWidth = 0
                if (extractTime != null && extractTime < effectiveEnd) {
                    extractLeft = Math.max(0, ((extractTime - effectiveStart) / viewDuration) * 100)
                    extractWidth = Math.max(0, 100 - extractLeft)
                }

                return (
                    <div key={row.profileId} className="flex items-center" style={{ height: 28, marginBottom: 1 }}>
                        {/* Player name with icon */}
                        <div className="flex items-center" style={{ width: 180, flexShrink: 0, fontSize: '13px', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                            {getLegendIcon(row.player, row.color, row.pmcIdx)}
                            <span className="text-eft" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {row.name}
                            </span>
                        </div>
                        {/* Segments bar */}
                        <div className="relative flex-1" style={{ height: 20, background: 'rgba(154,136,102,0.08)', borderRadius: 2, overflow: 'hidden' }}>
                            {/* Pre-spawn hatched area */}
                            {preSpawnWidth > 0.1 && (
                                <div className="rr-hatch-prespawn" style={{
                                    position: 'absolute', left: `${preSpawnLeft}%`, width: `${preSpawnWidth}%`,
                                    height: '100%', zIndex: 1,
                                }} />
                            )}
                            {/* Behavior segments */}
                            {row.segments.map((seg: BehaviorSegment, i: number) => {
                                const segStart = Math.max(seg.startTime, effectiveStart)
                                const segEnd = Math.min(seg.endTime, effectiveEnd)
                                if (segStart >= effectiveEnd || segEnd <= effectiveStart) return null
                                const left = ((segStart - effectiveStart) / viewDuration) * 100
                                const width = ((segEnd - segStart) / viewDuration) * 100
                                const isPassive = seg.category === 'idle' || seg.category === 'patrol'
                                return (
                                    <div
                                        key={i}
                                        style={{
                                            position: 'absolute',
                                            left: `${left}%`,
                                            width: `${Math.max(width, 0.2)}%`,
                                            height: '100%',
                                            background: isPassive ? 'rgba(154,136,102,0.12)' : seg.categoryColor,
                                            opacity: isPassive ? 0.5 : 0.85,
                                            borderRadius: 1,
                                            cursor: 'pointer',
                                            zIndex: 2,
                                        }}
                                        onMouseEnter={(e) => setHoveredSegment({ seg, playerName: row.name, x: e.clientX, y: e.clientY })}
                                        onMouseMove={(e) => setHoveredSegment(prev => prev ? { ...prev, x: e.clientX, y: e.clientY } : null)}
                                        onMouseLeave={() => setHoveredSegment(null)}
                                    />
                                )
                            })}
                            {/* Death hatched area */}
                            {deathWidth > 0.1 && (
                                <div className="rr-hatch-dead" style={{
                                    position: 'absolute', left: `${deathLeft}%`, width: `${deathWidth}%`,
                                    height: '100%', zIndex: 3,
                                }} />
                            )}
                            {/* Extracted hatched area */}
                            {extractWidth > 0.1 && (
                                <div className="rr-hatch-extracted" style={{
                                    position: 'absolute', left: `${extractLeft}%`, width: `${extractWidth}%`,
                                    height: '100%', zIndex: 3,
                                }} title="Extracted" />
                            )}
                        </div>
                    </div>
                )
            })}

            {/* Horizontal scroll bar (only when zoomed) */}
            {viewRange && (
                <div className="flex" style={{ marginTop: 6 }}>
                    <div style={{ width: 180, flexShrink: 0 }}></div>
                    <div className="flex-1" style={{ position: 'relative', height: 16 }}>
                        {/* Track background showing full raid extent */}
                        <div style={{ position: 'absolute', top: 6, left: 0, right: 0, height: 4, background: 'rgba(154,136,102,0.15)', borderRadius: 2 }} />
                        {/* Thumb showing current view window */}
                        {(() => {
                            const fullDuration = raidEnd - raidStart || 1
                            const thumbLeft = ((effectiveStart - raidStart) / fullDuration) * 100
                            const thumbWidth = Math.max(((effectiveEnd - effectiveStart) / fullDuration) * 100, 2)
                            return (
                                <div
                                    style={{
                                        position: 'absolute', top: 3, height: 10, borderRadius: 3,
                                        left: `${thumbLeft}%`, width: `${thumbWidth}%`,
                                        background: 'rgba(154,136,102,0.5)', cursor: 'grab',
                                        border: '1px solid rgba(154,136,102,0.7)',
                                        zIndex: 2,
                                    }}
                                    onMouseDown={(e) => {
                                        if (e.button !== 0) return
                                        e.preventDefault()
                                        const startX = e.clientX
                                        const startRange = { ...viewRange }
                                        const parentRect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
                                        const pxPerMs = parentRect.width / fullDuration

                                        const onMove = (me: MouseEvent) => {
                                            const dx = me.clientX - startX
                                            const dtMs = dx / pxPerMs
                                            let newStart = startRange.start + dtMs
                                            let newEnd = startRange.end + dtMs
                                            // Clamp
                                            if (newStart < raidStart) { newEnd += raidStart - newStart; newStart = raidStart }
                                            if (newEnd > raidEnd) { newStart -= newEnd - raidEnd; newEnd = raidEnd }
                                            setViewRange({ start: Math.max(newStart, raidStart), end: Math.min(newEnd, raidEnd) })
                                        }
                                        const onUp = () => {
                                            document.removeEventListener('mousemove', onMove)
                                            document.removeEventListener('mouseup', onUp)
                                        }
                                        document.addEventListener('mousemove', onMove)
                                        document.addEventListener('mouseup', onUp)
                                    }}
                                />
                            )
                        })()}
                        {/* Click on track to jump */}
                        <div
                            style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '100%', cursor: 'pointer' }}
                            onClick={(e) => {
                                const rect = e.currentTarget.getBoundingClientRect()
                                const pct = (e.clientX - rect.left) / rect.width
                                const fullDuration = raidEnd - raidStart || 1
                                const clickTime = raidStart + pct * fullDuration
                                const halfView = viewDuration / 2
                                let newStart = clickTime - halfView
                                let newEnd = clickTime + halfView
                                if (newStart < raidStart) { newEnd += raidStart - newStart; newStart = raidStart }
                                if (newEnd > raidEnd) { newStart -= newEnd - raidEnd; newEnd = raidEnd }
                                setViewRange({ start: Math.max(newStart, raidStart), end: Math.min(newEnd, raidEnd) })
                            }}
                        />
                    </div>
                </div>
            )}

            {/* Hover tooltip */}
            {hoveredSegment && (
                <div style={{
                    position: 'fixed',
                    left: hoveredSegment.x + 12,
                    top: hoveredSegment.y - 10,
                    background: '#1a1a1a',
                    border: '1px solid #9a8866',
                    padding: '8px 12px',
                    fontSize: '13px',
                    zIndex: 9999,
                    pointerEvents: 'none',
                    maxWidth: 320,
                }}>
                    <div style={{ color: (hoveredSegment.seg.category === 'idle' || hoveredSegment.seg.category === 'patrol') ? '#9a8866' : hoveredSegment.seg.categoryColor, fontWeight: 'bold' }}>
                        {hoveredSegment.seg.label}
                    </div>
                    <div style={{ color: '#ccc' }}>
                        {hoveredSegment.seg.decision ? formatDecisionLabel(hoveredSegment.seg.decision) : 'No active decision'}
                    </div>
                    <div style={{ color: '#999', fontSize: '12px' }}>
                        {hoveredSegment.playerName} &middot; {msToHMS(hoveredSegment.seg.startTime)} - {msToHMS(hoveredSegment.seg.endTime)}
                        {' '}({((hoveredSegment.seg.endTime - hoveredSegment.seg.startTime) / 1000).toFixed(1)}s)
                    </div>
                </div>
            )}
        </div>
    )
}
