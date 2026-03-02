import { LoaderFunctionArgs, useLoaderData, useOutletContext } from "react-router-dom";
import { useMemo, useState } from "react";
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
        const catKey = cat?.key ?? ''

        if (!catKey) {
            if (current) { segments.push(current); current = null }
            continue
        }

        if (current && current.category === catKey) {
            current.endTime = Number(entry.time)
        } else {
            if (current) segments.push(current)
            current = {
                category: catKey,
                categoryColor: cat?.color ?? '#6B7280',
                decision,
                label: cat?.label ?? 'Unknown',
                startTime: Number(entry.time),
                endTime: Number(entry.time),
            }
        }
    }
    if (current) segments.push(current)
    return segments
}

export default function RaidBehaviorTimeline() {
    const { positions } = useLoaderData() as { positions: Record<string, TrackingPositionalData[]> };
    const { raid, intl: intl_dir_ot } = useOutletContext() as { raid: TrackingRaidData, intl: { [key: string]: string } };
    const intl_dir: Record<string, string> = useMemo(() => ({ ...intl_dir_ot, ...cyr_to_en }), [intl_dir_ot]);
    const pmcIndexMap = useMemo(() => raid?.players ? buildPmcIndexMap(raid.players) : {}, [raid?.players]);

    const [hoveredSegment, setHoveredSegment] = useState<{ seg: BehaviorSegment, playerName: string, x: number, y: number } | null>(null);

    const data = useMemo(() => {
        if (!positions || !raid?.players) return { players: [] as any[], raidStart: 0, raidEnd: 0 }

        let raidStart = Infinity, raidEnd = 0
        const playerRows: { profileId: string, name: string, player: any, color: string, segments: BehaviorSegment[], pmcIdx?: number }[] = []

        for (const p of raid.players) {
            // Skip BTR
            if (p.type?.includes('BTR')) continue
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
            playerRows.push({
                profileId: p.profileId,
                name: intl(p.name, intl_dir),
                player: p,
                color: getPlayerColor(p, idx),
                segments,
                pmcIdx: pmcIndexMap[p.profileId],
            })
        }

        // Sort: PMCs first, then by name
        playerRows.sort((a, b) => {
            const aIsPMC = a.player.team === 'Usec' || a.player.team === 'Bear'
            const bIsPMC = b.player.team === 'Usec' || b.player.team === 'Bear'
            if (aIsPMC !== bIsPMC) return aIsPMC ? -1 : 1
            return a.name.localeCompare(b.name)
        })

        return { players: playerRows, raidStart, raidEnd }
    }, [positions, raid, intl_dir, pmcIndexMap])

    const { players: playerRows, raidStart, raidEnd } = data
    const raidDuration = raidEnd - raidStart || 1

    // Time axis ticks (every 60 seconds)
    const ticks: number[] = []
    for (let t = raidStart; t <= raidEnd; t += 60000) {
        ticks.push(t)
    }

    if (playerRows.length === 0) {
        return (
            <div className="p-4 text-eft text-center opacity-50">
                No behavior data available. Play a raid with the updated 1.0.0 mod to capture bot decisions.
            </div>
        )
    }

    const hasSain = !!raid?.detectedMods?.match(/SAIN/gi)

    return (
        <div className="p-4" style={{ overflowX: 'auto' }}>
            {/* SAIN recommendation banner */}
            {!hasSain && (
                <div className="mb-3 px-3 py-2" style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 4, fontSize: '12px', color: '#F59E0B' }}>
                    <strong>SAIN recommended</strong> — Install <a href="https://hub.sp-tarkov.com/files/file/1062-sain-solarint-s-ai-modifications-full-ai-combat-system-replacement/" target="_blank" rel="noreferrer" style={{ color: '#F59E0B', textDecoration: 'underline' }}>SAIN</a> for detailed bot behavior data (Search, StandAndShoot, FirstAid, etc.). Without SAIN, behavior categories are approximate.
                </div>
            )}

            {/* Legend */}
            <div className="flex flex-wrap gap-4 mb-4">
                {Object.values(BEHAVIOR_CATEGORIES).map(cat => (
                    <div key={cat.key} className="flex items-center gap-1" style={{ fontSize: '11px' }}>
                        <span style={{ width: 10, height: 10, borderRadius: 2, background: cat.color, display: 'inline-block' }}></span>
                        <span className="text-eft">{cat.label}</span>
                    </div>
                ))}
            </div>

            {/* Time axis */}
            <div className="flex" style={{ marginBottom: 2 }}>
                <div style={{ width: 160, flexShrink: 0 }}></div>
                <div className="relative flex-1" style={{ height: 16 }}>
                    {ticks.map(t => {
                        const left = ((t - raidStart) / raidDuration) * 100
                        return (
                            <span key={t} style={{
                                position: 'absolute', left: `${left}%`, fontSize: '9px',
                                color: '#9a8866', transform: 'translateX(-50%)', whiteSpace: 'nowrap'
                            }}>
                                {msToHMS(t)}
                            </span>
                        )
                    })}
                </div>
            </div>

            {/* Player rows */}
            {playerRows.map(row => (
                <div key={row.profileId} className="flex items-center" style={{ height: 26, marginBottom: 1 }}>
                    {/* Player name with icon */}
                    <div className="flex items-center" style={{ width: 160, flexShrink: 0, fontSize: '11px', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                        {getLegendIcon(row.player, row.color, row.pmcIdx)}
                        <span className="text-eft" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {row.name}
                        </span>
                    </div>
                    {/* Segments bar */}
                    <div className="relative flex-1" style={{ height: 20, background: 'rgba(154,136,102,0.08)', borderRadius: 2 }}>
                        {row.segments.map((seg: BehaviorSegment, i: number) => {
                            const left = ((seg.startTime - raidStart) / raidDuration) * 100
                            const width = ((seg.endTime - seg.startTime) / raidDuration) * 100
                            return (
                                <div
                                    key={i}
                                    style={{
                                        position: 'absolute',
                                        left: `${left}%`,
                                        width: `${Math.max(width, 0.2)}%`,
                                        height: '100%',
                                        background: seg.categoryColor,
                                        opacity: 0.85,
                                        borderRadius: 1,
                                        cursor: 'pointer',
                                    }}
                                    onMouseEnter={(e) => setHoveredSegment({ seg, playerName: row.name, x: e.clientX, y: e.clientY })}
                                    onMouseMove={(e) => setHoveredSegment(prev => prev ? { ...prev, x: e.clientX, y: e.clientY } : null)}
                                    onMouseLeave={() => setHoveredSegment(null)}
                                />
                            )
                        })}
                    </div>
                </div>
            ))}

            {/* Hover tooltip */}
            {hoveredSegment && (
                <div style={{
                    position: 'fixed',
                    left: hoveredSegment.x + 12,
                    top: hoveredSegment.y - 10,
                    background: '#1a1a1a',
                    border: '1px solid #9a8866',
                    padding: '6px 10px',
                    fontSize: '11px',
                    zIndex: 9999,
                    pointerEvents: 'none',
                    maxWidth: 300,
                }}>
                    <div style={{ color: hoveredSegment.seg.categoryColor, fontWeight: 'bold' }}>
                        {hoveredSegment.seg.label}
                    </div>
                    <div style={{ color: '#ccc' }}>
                        {formatDecisionLabel(hoveredSegment.seg.decision)}
                    </div>
                    <div style={{ color: '#999', fontSize: '10px' }}>
                        {hoveredSegment.playerName} &middot; {msToHMS(hoveredSegment.seg.startTime)} - {msToHMS(hoveredSegment.seg.endTime)}
                        {' '}({((hoveredSegment.seg.endTime - hoveredSegment.seg.startTime) / 1000).toFixed(1)}s)
                    </div>
                </div>
            )}
        </div>
    )
}
