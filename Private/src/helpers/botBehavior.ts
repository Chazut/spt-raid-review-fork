export interface BehaviorCategory {
    key: string
    label: string
    color: string
}

export const BEHAVIOR_CATEGORIES: Record<string, BehaviorCategory> = {
    combat:   { key: 'combat',   label: 'Combat',   color: '#EF4444' },
    search:   { key: 'search',   label: 'Search',   color: '#F59E0B' },
    movement: { key: 'movement', label: 'Movement', color: '#3B82F6' },
    patrol:   { key: 'patrol',   label: 'Patrol',   color: '#22C55E' },
    medical:  { key: 'medical',  label: 'Medical',  color: '#EC4899' },
    loot:     { key: 'loot',     label: 'Loot',     color: '#FACC15' },
    flee:     { key: 'flee',     label: 'Flee',     color: '#A855F7' },
    extract:  { key: 'extract',  label: 'Extract',  color: '#06B6D4' },
    grenade:  { key: 'grenade',  label: 'Grenade',  color: '#FF6B6B' },
    quest:    { key: 'quest',    label: 'Quest',    color: '#00BFFF' },
    idle:     { key: 'idle',     label: 'Idle',     color: '#374151' },
    other:    { key: 'other',    label: 'Other',    color: '#6B7280' },
}

const DECISION_TO_CATEGORY: Record<string, string> = {
    // ── Vanilla BotLogicDecision ──
    // Combat
    shootFromPlace: 'combat', shootFromCover: 'combat', shootToSmoke: 'combat',
    dogFight: 'combat', suppressFire: 'combat', suppressGrenade: 'combat', suppressStationary: 'combat',
    attackMoving: 'combat', attackMovingWithSuppress: 'combat', attackMovingFlank: 'combat',
    axeTarget: 'combat', oneMeleeAttack: 'combat', grenadeSuicide: 'combat',
    runToStationary: 'combat', shootFromStationary: 'combat',
    // Search
    search: 'search',
    // Movement
    goToPoint: 'movement', goToPointTactical: 'movement',
    goToCoverPoint: 'movement', goToCoverPointTactical: 'movement',
    runToCover: 'movement', runToCoverZigZag: 'movement', teleportToCover: 'movement',
    holdPosition: 'movement',
    goToEnemy: 'movement', goToEnemyZigZag: 'movement',
    runToEnemy: 'movement', runToEnemyZigZag: 'movement',
    // Patrol
    simplePatrol: 'patrol', followerPatrol: 'patrol', alternativePatrol: 'patrol',
    standBy: 'patrol', peaceful: 'patrol', peaceLook: 'patrol', peaceHardAim: 'patrol',
    // Medical
    heal: 'medical', healStimulators: 'medical', eatDrink: 'medical',
    repairMalfunction: 'other', healAnotherTarget: 'medical',
    // Loot
    botTakeItem: 'loot', botDropItem: 'loot', deadBody: 'loot', goToLootPointNode: 'loot',
    // Flee
    runAwayGrenade: 'flee', runAwayArtillery: 'flee', runAwayBTR: 'flee',
    flashed: 'flee', panicSitting: 'flee', turnAwayLight: 'flee',
    // Extract
    goToExfiltrationPointNode: 'extract', leaveMap: 'extract',
    // Grenade
    throwGrenadeFromPlace: 'grenade', runAndThrowGrenadeFromPlace: 'grenade',
    // Other
    doorOpen: 'other', warnPlayer: 'other', friendlyTilt: 'other', gesture: 'other',
    crawl: 'other', moveStealthy: 'other', lay: 'other', watchSecondWeapon: 'other',
    summon: 'other', followPlayer: 'other', followMeRequest: 'other',
    plantMine: 'other', deactivateMine: 'other',
    khorovodChristmasEvent: 'other', doGiftChristmasEvent: 'other',

    // ── SAIN ECombatDecision ──
    MoveToEngage: 'combat', StandAndShoot: 'combat', ShootDistantEnemy: 'combat',
    DogFight: 'combat', RushEnemy: 'combat', MeleeAttack: 'combat',
    FightZombies: 'combat', Freeze: 'combat',
    Search: 'search',
    SeekCover: 'movement', ShiftCover: 'movement', Retreat: 'movement',
    ThrowGrenade: 'grenade',

    // ── SAIN ESquadDecision ──
    PushSuppressedEnemy: 'combat', GroupSearch: 'search', Suppress: 'combat',
    Help: 'movement', Regroup: 'movement',

    // ── SAIN ESelfActionType ──
    Reload: 'other', FirstAid: 'medical', Surgery: 'medical', Stims: 'medical',

    // ── SAIN ESAINLayer (fallback broad categories) ──
    Combat: 'combat', Squad: 'combat', Extract: 'extract',
    Run: 'flee', Peace: 'patrol', AvoidThreat: 'flee',

    // ── BigBrain numeric layer IDs (fallback if SAIN reflection fails) ──
    '9000': 'idle',         // SAIN DebugLayer (default/inactive)
    '9001': 'flee',         // SAIN AvoidThreatLayer
    '9002': 'extract',      // SAIN ExtractLayer
    '9003': 'combat',       // SAIN CombatSquadLayer
    '9004': 'combat',       // SAIN CombatSoloLayer
}

export function getBehaviorCategory(decision: string | undefined | null): BehaviorCategory {
    if (!decision || decision === '') return BEHAVIOR_CATEGORIES.idle
    if (decision.startsWith('QB:')) return BEHAVIOR_CATEGORIES.quest
    if (decision.startsWith('LootingBots:')) return BEHAVIOR_CATEGORIES.loot
    const cleanDecision = decision.startsWith('SAIN:') ? decision.substring(5) : decision
    const categoryKey = DECISION_TO_CATEGORY[cleanDecision] ?? 'other'
    return BEHAVIOR_CATEGORIES[categoryKey]
}

export function formatDecisionLabel(decision: string | undefined | null): string {
    if (!decision || decision === '') return ''
    if (decision.startsWith('QB:')) return decision.substring(3)
    if (decision.startsWith('LootingBots:')) return decision.substring(12)
    const clean = decision.startsWith('SAIN:') ? decision.substring(5) : decision
    // Convert camelCase to readable: "shootFromPlace" -> "Shoot From Place"
    return clean.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim()
}
