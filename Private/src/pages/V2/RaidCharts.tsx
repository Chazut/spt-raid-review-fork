import { useEffect, useMemo, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

import './Raids.css'
import './RaidCharts.css'
import { useOutletContext } from 'react-router-dom';
import { TrackingPlayerStatus, TrackingRaidData } from '../../types/api_types';
import _ from 'lodash';
import { intl, msToHMS } from '../../helpers';
import { getLegendIcon, getPlayerColor, getPlayerFaction, buildPmcIndexMap } from '../../helpers/players';

import cyr_to_en from '../../assets/cyr_to_en.json';

const PIE_COLORS = [
    '#9a8866', '#c4a96a', '#7a6b4e', '#bfa55a', '#d4c090',
    '#5c5038', '#e0cc9a', '#8c7a56', '#a89260', '#6e6040',
];

const PERSONALITY_COLORS: Record<string, string> = {
    'normal': '#3B82F6',
    'timmy': '#22C55E',
    'rat': '#A855F7',
    'chad': '#EF4444',
    'gigachad': '#FF0040',
    'coward': '#FACC15',
    'snappingturtle': '#14B8A6',
    'player': '#06B6D4',
};

const PERSONALITY_FALLBACK = [
    '#FF6B6B', '#06B6D4', '#14B8A6', '#F472B6', '#A78BFA',
    '#34D399', '#FBBF24', '#FB923C', '#E879F9', '#2DD4BF',
];

const DIFFICULTY_COLORS: Record<string, string> = {
    'easy': '#22C55E',
    'normal': '#3B82F6',
    'hard': '#F59E0B',
    'impossible': '#EF4444',
    'default': '#6B7280',
};

const FACTION_COLORS: Record<string, string> = {
    'PMC': '#3357FF',
    'Player Scav': '#33FF8D',
    'Scav': '#33FF57',
    'Sniper': '#00911a',
    'Boss': '#FF0000',
    'Goon': '#ff005d',
    'Follower': '#ff7b00',
    'Rogue': '#ff7b00',
    'Raider': '#FF00FF',
    'Cultist': '#6f00ff',
    'Bloodhound': '#6d0000',
    'Mercenary': '#FFD700',
    'RUAF': '#4A90D9',
    'UNTAR': '#00BFFF',
    'Black Div': '#555555',
    'Infected': '#7FFF00',
    'Other': '#00eeff',
    'Unknown': '#999',
};

function getFactionGroup(faction: string): string {
    switch (faction) {
        case 'PMC': return 'PMC';
        case 'Player Scav':
        case 'Scav':
        case 'Sniper': return 'Scav';
        case 'Boss': return 'Boss';
        case 'Goon': return 'Goon';
        case 'Follower':
        case 'Rogue':
        case 'Raider': return 'Raider/Rogue';
        case 'Cultist': return 'Cultist';
        case 'Bloodhound': return 'Bloodhound';
        case 'Mercenary':
        case 'RUAF':
        case 'UNTAR':
        case 'Black Div': return 'Factions';
        case 'Infected': return 'Infected';
        default: return 'Other';
    }
}

type PlayerEntry = { name: string, playerObj: any, color: string, pmcIdx?: number };

const TT: React.CSSProperties = { background: '#1a1a1a', border: '1px solid #9a8866', padding: '6px 10px', fontSize: '11px', maxWidth: '360px' };
const TT_WIDE: React.CSSProperties = { ...TT, maxWidth: '400px', maxHeight: '350px', overflowY: 'auto' };

function PlayerIcon({ player, color, pmcIdx }: { player: any, color: string, pmcIdx?: number }) {
    if (!player) return null;
    return getLegendIcon(player, color, pmcIdx);
}

function PlayerLine({ p }: { p: PlayerEntry }) {
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '1px', marginRight: '6px' }}>
            <PlayerIcon player={p.playerObj} color={p.color} pmcIdx={p.pmcIdx} />
            <span style={{ color: '#ccc' }}>{p.name}</span>
        </span>
    );
}

// Tooltip for Faction + Personality pies: show player names with icons
function PiePlayersTooltip({ active, payload }: any) {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    const players = d?.players as PlayerEntry[] | undefined;
    return (
        <div style={TT_WIDE}>
            <div style={{ color: d?.color || '#9a8866', marginBottom: '4px', fontWeight: 'bold' }}>{d?.name} ({d?.value})</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 0' }}>
                {players?.slice(0, 20).map((p, i) => <PlayerLine key={i} p={p} />)}
            </div>
            {players && players.length > 20 && <div style={{ color: '#666', marginTop: '2px' }}>+{players.length - 20} more</div>}
        </div>
    );
}

// Tooltip for Difficulty pie: group by faction group, show player names
function DifficultyTooltip({ active, payload }: any) {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    const groups = d?.groups as Record<string, PlayerEntry[]> | undefined;
    return (
        <div style={TT_WIDE}>
            <div style={{ color: d?.color || '#9a8866', marginBottom: '4px', fontWeight: 'bold' }}>{d?.name} ({d?.value})</div>
            {groups && Object.entries(groups).sort((a, b) => b[1].length - a[1].length).map(([group, players]) => (
                <div key={group} style={{ marginBottom: '4px' }}>
                    <div style={{ color: '#9a8866', fontWeight: 'bold', fontSize: '10px', marginBottom: '1px' }}>{group} ({players.length})</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 0', paddingLeft: '4px' }}>
                        {players.slice(0, 12).map((p, i) => <PlayerLine key={i} p={p} />)}
                        {players.length > 12 && <span style={{ color: '#666' }}>+{players.length - 12}</span>}
                    </div>
                </div>
            ))}
        </div>
    );
}

function ActiveBotsTooltip({ active, payload }: any) {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    const factions = d?.factions as Record<string, number> | undefined;
    return (
        <div style={TT}>
            <div style={{ color: '#9a8866', marginBottom: '4px', fontWeight: 'bold' }}>{d?.name} — {d?.uv} bots</div>
            {factions && Object.keys(FACTION_COLORS).filter(f => factions[f]).map(faction => [faction, factions[faction]] as [string, number]).map(([faction, count]) => (
                <div key={faction} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: FACTION_COLORS[faction] || '#999', flexShrink: 0 }}></span>
                    <span style={{ color: FACTION_COLORS[faction] || '#ccc' }}>{faction}: <strong>{count}</strong></span>
                </div>
            ))}
        </div>
    );
}

function KillsTooltip({ active, payload }: any) {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    const details = d?.details as any[] | undefined;
    return (
        <div style={TT}>
            <div style={{ color: '#EF4444', marginBottom: '4px', fontWeight: 'bold' }}>{d?.name} — {d?.uv} kill{d?.uv > 1 ? 's' : ''}</div>
            {details?.slice(0, 8).map((k: any, i: number) => (
                <div key={i} style={{ color: '#ccc', display: 'flex', alignItems: 'center', gap: '2px', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                    <PlayerIcon player={k.killerPlayer} color={k.killerColor} pmcIdx={k.killerPmcIdx} />
                    <span style={{ color: '#EF4444' }}>{k.killer}</span>
                    <span style={{ opacity: 0.5, margin: '0 2px' }}>{' → '}</span>
                    <PlayerIcon player={k.victimPlayer} color={k.victimColor} pmcIdx={k.victimPmcIdx} />
                    <strong>{k.victim}</strong>
                    <span style={{ opacity: 0.5, marginLeft: '4px' }}>({k.weapon}, {k.distance}m)</span>
                </div>
            ))}
            {details && details.length > 8 && <div style={{ color: '#666' }}>+{details.length - 8} more</div>}
        </div>
    );
}

function LootingTooltip({ active, payload }: any) {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    const details = d?.details as any[] | undefined;
    return (
        <div style={TT}>
            <div style={{ color: '#22C55E', marginBottom: '4px', fontWeight: 'bold' }}>{d?.name} — {d?.uv} loot event{d?.uv > 1 ? 's' : ''}</div>
            {details?.slice(0, 8).map((l: any, i: number) => (
                <div key={i} style={{ color: '#ccc', display: 'flex', alignItems: 'center', gap: '2px', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                    <PlayerIcon player={l.playerObj} color={l.playerColor} pmcIdx={l.playerPmcIdx} />
                    <span style={{ color: '#9a8866' }}>{l.player}</span>
                    <span style={{ color: l.added ? '#22C55E' : '#F59E0B' }}>{l.added ? ' looted ' : ' dropped '}</span>
                    <strong>{l.qty > 1 ? `${l.qty}x ` : ''}{l.item}</strong>
                </div>
            ))}
            {details && details.length > 8 && <div style={{ color: '#666' }}>+{details.length - 8} more</div>}
        </div>
    );
}

function ShotsTooltip({ active, payload }: any) {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    const shooters = d?.shooters as any[] | undefined;
    return (
        <div style={TT}>
            <div style={{ color: '#8B5CF6', marginBottom: '4px', fontWeight: 'bold' }}>{d?.name} — {d?.uv} shot{d?.uv > 1 ? 's' : ''}</div>
            {shooters?.slice(0, 6).map((s: any, i: number) => (
                <div key={i} style={{ color: '#ccc', display: 'flex', alignItems: 'center', gap: '2px', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                    <PlayerIcon player={s.playerObj} color={s.playerColor} pmcIdx={s.playerPmcIdx} />
                    <span style={{ color: '#9a8866' }}>{s.name}</span>:
                    <strong style={{ marginLeft: '2px' }}>{s.count}</strong> shot{s.count > 1 ? 's' : ''}
                    {s.weapon && <span style={{ opacity: 0.5, marginLeft: '4px' }}>({s.weapon})</span>}
                </div>
            ))}
            {shooters && shooters.length > 6 && <div style={{ color: '#666' }}>+{shooters.length - 6} more</div>}
        </div>
    );
}

function PieLabel({ cx, cy, midAngle, outerRadius, name, value }: any) {
    const RADIAN = Math.PI / 180;
    const radius = outerRadius + 14;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);
    return (
        <text x={x} y={y} fill="#9a8866" textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central" fontSize={12}>
            {name} ({value})
        </text>
    );
}

export default function RaidCharts() {
    const [ botsByFaction, setBotsByFaction ] = useState([] as any[]);
    const [ pmcPersonalities, setPmcPersonalities ] = useState([] as any[]);
    const [ botsByDifficulty, setBotsByDifficulty ] = useState([] as any[]);

    const [ activeBots, setActiveBots ] = useState([] as any[]);
    const [ kills, setKills ] = useState([] as any[]);
    const [ lootings, setLootings ] = useState([] as any[]);
    const [ shots, setShots ] = useState([] as any[]);

    const { raid, intl: intl_dir_ot } = useOutletContext() as {
        raid: TrackingRaidData,
        intl: { [key: string]: string }
    };

    const intl_dir: Record<string, string> = useMemo(() => ({...intl_dir_ot, ...cyr_to_en}), [intl_dir_ot]);

    useEffect(() => {
        if (raid && raid.players) {

            // Build lookup maps
            const playerNameMap: Record<string, string> = {};
            const playerFactionMap: Record<string, string> = {};
            const playerObjMap: Record<string, any> = {};
            const playerColorMap: Record<string, string> = {};
            const pmcIndexMap = buildPmcIndexMap(raid.players);
            for (let idx = 0; idx < raid.players.length; idx++) {
                const p = raid.players[idx];
                playerNameMap[p.profileId] = intl(p.name, intl_dir);
                playerFactionMap[p.profileId] = getPlayerFaction(p);
                playerObjMap[p.profileId] = p;
                playerColorMap[p.profileId] = getPlayerColor(p, idx);
            }

            function makeEntry(p: any): PlayerEntry {
                return {
                    name: playerNameMap[p.profileId],
                    playerObj: p,
                    color: playerColorMap[p.profileId],
                    pmcIdx: pmcIndexMap[p.profileId]
                };
            }

            // Faction pie: { name, value, players[] }
            const factionMap: Record<string, PlayerEntry[]> = {};
            // Personality pie (PMC only): { name, value, players[] }
            const brainMap: Record<string, PlayerEntry[]> = {};
            // Difficulty pie: { name, value, groups: { factionGroup: PlayerEntry[] } }
            const diffMap: Record<string, Record<string, PlayerEntry[]>> = {};

            for (let i = 0; i < raid.players.length; i++) {
                const player: any = raid.players[i];
                const faction = getPlayerFaction(player);
                const group = getFactionGroup(faction);
                const entry = makeEntry(player);

                // Faction
                if (!factionMap[faction]) factionMap[faction] = [];
                factionMap[faction].push(entry);

                // Personality — PMC only
                const isPMC = player.team === 'Usec' || player.team === 'Bear';
                if (isPMC && player.mod_SAIN_brain) {
                    const brainKey = player.mod_SAIN_brain.toLowerCase();
                    if (brainKey !== 'player') {
                        if (!brainMap[brainKey]) brainMap[brainKey] = [];
                        brainMap[brainKey].push(entry);
                    }
                }

                // Difficulty
                if (player.mod_SAIN_difficulty) {
                    const diffKey = player.mod_SAIN_difficulty.toLowerCase() || 'default';
                    if (!diffMap[diffKey]) diffMap[diffKey] = {};
                    if (!diffMap[diffKey][group]) diffMap[diffKey][group] = [];
                    diffMap[diffKey][group].push(entry);
                }
            }

            const factionData = Object.entries(factionMap)
                .map(([name, players]) => ({ name, value: players.length, players, color: FACTION_COLORS[name] || '#999' }))
                .sort((a, b) => b.value - a.value);
            setBotsByFaction(factionData);

            const personalityData = Object.entries(brainMap)
                .map(([name, players], i) => ({ name, value: players.length, players, color: PERSONALITY_COLORS[name] || PERSONALITY_FALLBACK[i % PERSONALITY_FALLBACK.length] }))
                .sort((a, b) => b.value - a.value);
            setPmcPersonalities(personalityData);

            const diffData = Object.entries(diffMap)
                .map(([name, groups], i) => ({
                    name,
                    value: Object.values(groups).reduce((s, arr) => s + arr.length, 0),
                    groups,
                    color: DIFFICULTY_COLORS[name] || PIE_COLORS[i % PIE_COLORS.length]
                }))
                .sort((a, b) => b.value - a.value);
            setBotsByDifficulty(diffData);

            // Calculate Active Bots (with faction breakdown)
            let playersByTime = _.chain(raid.player_status).filter((ps: TrackingPlayerStatus) => ps.status === 'Alive').groupBy('time').valuesIn().value();
            const activeBotsChartData = [];
            for (let i = 0; i < playersByTime.length; i++) {
                const playerStatuses = playersByTime[i];
                const first = _.first(playerStatuses);
                const factionBreakdown: Record<string, number> = {};
                for (const ps of playerStatuses) {
                    const faction = playerFactionMap[ps.profileId] || 'Unknown';
                    factionBreakdown[faction] = (factionBreakdown[faction] || 0) + 1;
                }
                activeBotsChartData.push({
                    name: msToHMS(Number(first?.time)),
                    uv: playerStatuses.length,
                    factions: factionBreakdown
                })
            }
            setActiveBots(activeBotsChartData)

            // Calculate Kills
            const killsGroup = [];
            let currentKillGroup = [] as any[];
            if (raid.kills) {
                for (let i = 0; i < raid.kills.length; i++) {
                    if (currentKillGroup.length === 0) {
                        currentKillGroup.push(raid.kills[i]);
                    } else {
                        const lastObject = currentKillGroup[currentKillGroup.length - 1];
                        if (raid.kills[i].time - lastObject.time <= 30000) {
                            currentKillGroup.push(raid.kills[i]);
                        } else {
                            killsGroup.push(currentKillGroup);
                            currentKillGroup = [raid.kills[i]];
                        }
                    }
                }
                if (currentKillGroup.length > 0) killsGroup.push(currentKillGroup);
            }

            const killChartData_ = [];
            for (let i = 0; i < killsGroup.length; i++) {
                const group = killsGroup[i];
                if (group && group[0] && group[0].time) {
                    killChartData_.push({
                        name: msToHMS(Number(group[0].time)),
                        uv: group.length,
                        details: group.map((k: any) => ({
                            killer: playerNameMap[k.profileId] || 'Unknown',
                            killerPlayer: playerObjMap[k.profileId] || null,
                            killerColor: playerColorMap[k.profileId] || '#999',
                            killerPmcIdx: pmcIndexMap[k.profileId],
                            victim: playerNameMap[k.killedId] || 'Unknown',
                            victimPlayer: playerObjMap[k.killedId] || null,
                            victimColor: playerColorMap[k.killedId] || '#999',
                            victimPmcIdx: pmcIndexMap[k.killedId],
                            weapon: intl(k.weapon.replace("Name", "ShortName"), intl_dir),
                            distance: Number(k.distance).toFixed(1)
                        }))
                    })
                }
            }
            setKills(killChartData_)

            // Calculate Lootings
            const lootingsGroup = [];
            let currentLootingGroup = [] as any[];
            if (raid.looting) {
                for (let i = 0; i < raid.looting.length; i++) {
                    if (currentLootingGroup.length === 0) {
                        currentLootingGroup.push(raid.looting[i]);
                    } else {
                        const lastObject = currentLootingGroup[currentLootingGroup.length - 1];
                        if (Number(raid.looting[i].time) - Number(lastObject.time) <= 5000) {
                            currentLootingGroup.push(raid.looting[i]);
                        } else {
                            lootingsGroup.push(currentLootingGroup);
                            currentLootingGroup = [raid.looting[i]];
                        }
                    }
                }
                if (currentLootingGroup.length > 0) lootingsGroup.push(currentLootingGroup);
            }

            const lootingChartData_ = [];
            for (let i = 0; i < lootingsGroup.length; i++) {
                const group = lootingsGroup[i];
                if (group && group[0] && group[0].time) {
                    lootingChartData_.push({
                        name: msToHMS(Number(group[0].time)),
                        uv: group.length,
                        details: group.map((l: any) => ({
                            player: playerNameMap[l.profileId] || 'Unknown',
                            playerObj: playerObjMap[l.profileId] || null,
                            playerColor: playerColorMap[l.profileId] || '#999',
                            playerPmcIdx: pmcIndexMap[l.profileId],
                            item: intl((l.itemName || l.name || '').replace("Short", ""), intl_dir),
                            qty: Number(l.qty) || 1,
                            added: !!String(l.added).match(/^(1|true)$/i)
                        }))
                    })
                }
            }
            setLootings(lootingChartData_)

            // Calculate Shots
            const shotsGroup = [];
            let currentShotGroup = [] as any[];
            if (raid.ballistic) {
                for (let i = 0; i < raid.ballistic.length; i++) {
                    if (currentShotGroup.length === 0) {
                        currentShotGroup.push(raid.ballistic[i]);
                    } else {
                        const lastObject = currentShotGroup[currentShotGroup.length - 1];
                        if (raid.ballistic[i].time - lastObject.time <= 2000) {
                            currentShotGroup.push(raid.ballistic[i]);
                        } else {
                            shotsGroup.push(currentShotGroup);
                            currentShotGroup = [raid.ballistic[i]];
                        }
                    }
                }
                if (currentShotGroup.length > 0) shotsGroup.push(currentShotGroup);
            }

            const shotChartData_ = [];
            for (let i = 0; i < shotsGroup.length; i++) {
                const group = shotsGroup[i];
                if (group && group[0] && group[0].time) {
                    const byShooter: Record<string, { count: number, weapons: Set<string>, profileId: string }> = {};
                    for (const s of group) {
                        const pid = s.profileId;
                        const name = playerNameMap[pid] || 'Unknown';
                        if (!byShooter[name]) byShooter[name] = { count: 0, weapons: new Set(), profileId: pid };
                        byShooter[name].count++;
                        if (s.weaponName) byShooter[name].weapons.add(s.weaponName);
                    }
                    shotChartData_.push({
                        name: msToHMS(Number(group[0].time)),
                        uv: group.length,
                        shooters: Object.entries(byShooter)
                            .sort((a, b) => b[1].count - a[1].count)
                            .map(([name, data]) => ({
                                name,
                                count: data.count,
                                weapon: [...data.weapons].join(', ') || null,
                                playerObj: playerObjMap[data.profileId] || null,
                                playerColor: playerColorMap[data.profileId] || '#999',
                                playerPmcIdx: pmcIndexMap[data.profileId]
                            }))
                    })
                }
            }
            setShots(shotChartData_)

        }

    }, [raid, intl_dir])

    return (
        <section className="chart-container">

            { raid.detectedMods?.match(/SAIN/gi) ?
            <div className="gauges my-4">
                <div>
                    <div className='text-center w-full text-lg font-bold bg-eft text-black'>Bots By Faction</div>
                    <div className="border border-eft pie-wrapper">
                        <ResponsiveContainer width="100%" height={240}>
                            <PieChart>
                                <Pie
                                    dataKey="value"
                                    isAnimationActive={false}
                                    data={botsByFaction}
                                    cx="50%"
                                    cy="50%"
                                    outerRadius={60}
                                    stroke='black'
                                    strokeWidth={2}
                                    label={PieLabel}
                                >
                                    {botsByFaction.map((d, i) => <Cell key={i} fill={FACTION_COLORS[d.name] || PIE_COLORS[i % PIE_COLORS.length]} />)}
                                </Pie>
                                <Tooltip content={<PiePlayersTooltip />} />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </div>
                <div>
                    <div className='text-center w-full text-lg font-bold bg-eft text-black'>PMC Personalities</div>
                    <div className="border border-eft pie-wrapper">
                        <ResponsiveContainer width="100%" height={240}>
                            <PieChart>
                                <Pie
                                    dataKey="value"
                                    isAnimationActive={false}
                                    data={pmcPersonalities}
                                    cx="50%"
                                    cy="50%"
                                    outerRadius={60}
                                    stroke='black'
                                    strokeWidth={2}
                                    label={PieLabel}
                                >
                                    {pmcPersonalities.map((d, i) => <Cell key={i} fill={PERSONALITY_COLORS[d.name] || PERSONALITY_FALLBACK[i % PERSONALITY_FALLBACK.length]} />)}
                                </Pie>
                                <Tooltip content={<PiePlayersTooltip />} />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </div>
                <div>
                    <div className='text-center w-full text-lg font-bold bg-eft text-black'>Bots By Difficulty</div>
                    <div className="border border-eft pie-wrapper">
                        <ResponsiveContainer width="100%" height={240}>
                            <PieChart>
                                <Pie
                                    dataKey="value"
                                    isAnimationActive={false}
                                    data={botsByDifficulty}
                                    cx="50%"
                                    cy="50%"
                                    outerRadius={60}
                                    stroke='black'
                                    strokeWidth={2}
                                    label={PieLabel}
                                >
                                    {botsByDifficulty.map((d, i) => <Cell key={i} fill={DIFFICULTY_COLORS[d.name] || PIE_COLORS[i % PIE_COLORS.length]} />)}
                                </Pie>
                                <Tooltip content={<DifficultyTooltip />} />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>
            : null }

            <div className='text-center w-full text-lg font-bold bg-eft text-black'>Active Bots By Time</div>
            <div className="chart mb-4 border border-eft">
                <ResponsiveContainer>
                    <AreaChart data={activeBots} margin={{ top: 10, right: 30 }}>
                    <Tooltip content={<ActiveBotsTooltip />} />
                    <XAxis dataKey="name" angle={-30} dy={20} dx={-30} />
                    <YAxis tickCount={5} />
                    <CartesianGrid strokeDasharray="1 1" stroke='#9a8866' />
                    <Area type="monotone" dataKey="uv" stroke="#9a8866" fill="#9a8866" />
                    </AreaChart>
                </ResponsiveContainer>
            </div>

            <div className='text-center w-full text-lg font-bold bg-eft text-black'>Kill Activity By Time</div>
            <div className="chart mb-4 border border-eft">
                <ResponsiveContainer>
                    <AreaChart data={kills} margin={{ top: 10, right: 30 }}>
                    <Tooltip content={<KillsTooltip />} />
                    <XAxis dataKey="name" angle={-30} dy={20} dx={-30} />
                    <YAxis tickCount={5} />
                    <CartesianGrid strokeDasharray="1 1" stroke='#9a8866' />
                    <Area type="monotone" dataKey="uv" stroke="#EF4444" fill="rgba(239,68,68,0.3)" />
                    </AreaChart>
                </ResponsiveContainer>
            </div>

            <div className='text-center w-full text-lg font-bold bg-eft text-black'>Looting Activity By Time</div>
            <div className="chart mb-4 border border-eft">
                <ResponsiveContainer>
                    <AreaChart data={lootings} margin={{ top: 10, right: 30 }}>
                    <Tooltip content={<LootingTooltip />} />
                    <XAxis dataKey="name" angle={-30} dy={20} dx={-30} />
                    <YAxis tickCount={5} />
                    <CartesianGrid strokeDasharray="1 1" stroke='#9a8866' />
                    <Area type="monotone" dataKey="uv" stroke="#22C55E" fill="rgba(34,197,94,0.3)" />
                    </AreaChart>
                </ResponsiveContainer>
            </div>

            <div className='text-center w-full text-lg font-bold bg-eft text-black'>Projectile Activity By Time</div>
            <div className="chart mb-4 border border-eft">
                <ResponsiveContainer>
                    <AreaChart data={shots} margin={{ top: 10, right: 30 }}>
                    <Tooltip content={<ShotsTooltip />} />
                    <XAxis dataKey="name" angle={-30} dy={20} dx={-30} />
                    <YAxis tickCount={10} />
                    <CartesianGrid strokeDasharray="1 1" stroke='#9a8866' />
                    <Area type="monotone" dataKey="uv" stroke="#8B5CF6" fill="rgba(139,92,246,0.3)" />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </section>
    );
}
