import { radianDifference } from "@pip-pip/core/src/math"
import { PointPhysicsRectWall, PointPhysicsSegmentWall } from "@pip-pip/core/src/physics"
import { PipPlayer, PlayerInputs } from "./player"
import { NavGrid, NavPoint, findPath, hasLineOfSight, worldToCell } from "./pathfinding"

// "Training-grounds" enemy bots. A bot is a server-simulated PipPlayer with no
// connection. Each tick the brain reads the world and writes the bot's
// PlayerInputs; the existing fire/move pipeline (updateSystems) does the rest,
// so a bot moves, aims and shoots exactly like a real player would.

// How close (world units) the bot tries to stay to its target. Inside the
// inner band it backs off; outside the outer band it chases; between them it
// strafes to keep pressure on without colliding.
export const BOT_DESIRED_RANGE = 350
// Half-width of the strafe band around BOT_DESIRED_RANGE.
export const BOT_RANGE_BAND = 120
// The bot only opens fire when the target is within this distance...
export const BOT_FIRE_RANGE = 600
// ...and its aim is within this many radians of the target.
export const BOT_FIRE_AIM_TOLERANCE = 0.25

// How often (in ticks) the AI re-targets + re-paths. The brain holds its
// movement intent between decisions and only refreshes aim every tick, so this
// cadence is imperceptible at 20Hz (3 ticks = 150ms) yet cuts the per-tick AI
// cost by ~3x. Small + load-bearing for the "lower CPU" requirement.
export const AI_DECISION_TICKS = 3

// How often (in ticks) a bot is allowed to recompute its A* path AROUND walls.
// ~10 ticks = 0.5s at 20Hz. A path is also rebuilt early if the target crosses
// into a different grid cell; otherwise the cached path is reused, so A* runs at
// most ~twice a second per bot instead of every tick.
export const PATH_RECOMPUTE_TICKS = 10

// A bot is considered to have "reached" a waypoint when it gets this close (in
// world units), at which point the path advances to the next waypoint.
export const PATH_WAYPOINT_REACHED = 60

// Trigger discipline: a bot waits ~reactionTicks * this many ticks between shots,
// so it fires in human bursts instead of a continuous machine-gun stream. Scaled
// by reaction time so EASY (slow) fires ~1.5/s and HARD (fast) ~3/s. No extra
// skill field or rng draw, so it does not perturb makeBotSkill's draw sequence.
export const FIRE_INTERVAL_PER_REACTION = 6

// Pathfinding dependencies handed to the bot brain so it stays unit-testable:
// the cached nav grid, the map walls (for line-of-sight + smoothing) and the
// current tick (the clock that drives the recompute cooldown). All are injected
// by updateBotInputs from the running game; tests can construct them directly.
export type BotNavContext = {
    grid: NavGrid,
    rectWalls: PointPhysicsRectWall[],
    segWalls: PointPhysicsSegmentWall[],
    tick: number,
}

// Per-bot difficulty. Stored on a bot (PipPlayer.difficulty) when it is created
// and used to derive its skill profile via makeBotSkill. "Mixed" is NOT a value
// here - it is a config-only choice (the host UI / commands) that rolls one of
// these per added bot, so what is stored is always a concrete difficulty.
export enum BotDifficulty {
    EASY = 0,
    MEDIUM = 1,
    HARD = 2,
}

// A single bot's varied skill profile. Numbers are in the same units the BOT_*
// constants use: radians for aimJitter/fireAimTolerance and world units for the
// ranges. computeBotInputs reads these off bot.skill (falling back to the BOT_*
// constants when absent), so two bots of the same difficulty can still differ.
export type BotSkill = {
    // Peak aim error (radians) the bot's aim WANDERS within. It is a slow random
    // walk (not per-tick white noise) so the ship actually points off-centre and
    // the shot misses, rather than the error averaging out. HARD barely wanders,
    // EASY sprays wide.
    aimJitter: number,
    // The bot only opens fire within this distance of its target.
    fireRange: number,
    // ...and only when its ship is aimed within this many radians of its PERCEIVED
    // target. Larger = fires while less aligned = sprays (EASY); smaller = waits
    // for a clean shot (HARD).
    fireAimTolerance: number,
    // The range the bot tries to hold (orbit distance), like BOT_DESIRED_RANGE.
    desiredRange: number,
    // Half-width of the strafe band around desiredRange, like BOT_RANGE_BAND.
    rangeBand: number,
    // Reaction lag in TICKS (20Hz, so ~50ms each). The bot aims at where the
    // target was this many ticks ago, so it cannot track a strafing target
    // perfectly. EASY ~2.4 ticks (~120ms), HARD ~1 tick (~50ms).
    reactionTicks: number,
}

// Base (pre-variance) skill numbers per difficulty. HARD is accurate + aggressive
// (tiny aimJitter, long fireRange, wide aim tolerance); EASY is sloppy + timid
// (large aimJitter, short fireRange, narrow tolerance). MEDIUM sits on the
// existing BOT_* constants so a MEDIUM bot behaves like today's single profile.
const BOT_SKILL_BASE: Record<BotDifficulty, BotSkill> = {
    [BotDifficulty.EASY]: {
        // Sloppy + slow: a wide wandering aim, a generous fire tolerance (so it
        // sprays while badly aligned) and a long ~120ms reaction lag.
        aimJitter: 0.5,
        fireRange: BOT_FIRE_RANGE * 0.7,
        fireAimTolerance: BOT_FIRE_AIM_TOLERANCE * 1.6,
        desiredRange: BOT_DESIRED_RANGE,
        rangeBand: BOT_RANGE_BAND,
        reactionTicks: 2.4,
    },
    [BotDifficulty.MEDIUM]: {
        aimJitter: 0.18,
        fireRange: BOT_FIRE_RANGE,
        fireAimTolerance: BOT_FIRE_AIM_TOLERANCE,
        desiredRange: BOT_DESIRED_RANGE,
        rangeBand: BOT_RANGE_BAND,
        reactionTicks: 1.6,
    },
    [BotDifficulty.HARD]: {
        // Sharp + quick: a barely-wandering aim, a tight fire tolerance (waits
        // for a clean shot) and a short ~50ms reaction.
        aimJitter: 0.05,
        fireRange: BOT_FIRE_RANGE * 1.3,
        fireAimTolerance: BOT_FIRE_AIM_TOLERANCE * 0.7,
        desiredRange: BOT_DESIRED_RANGE,
        rangeBand: BOT_RANGE_BAND,
        reactionTicks: 1.0,
    },
}

// Per-bot variance: each numeric skill field is multiplied by up to +/-20% so
// two same-difficulty bots still differ. ~0.2 means the factor lands in [0.8,
// 1.2].
export const BOT_SKILL_VARIANCE = 0.2

// Pure factory: derive a varied skill profile for a difficulty. rng is injected
// (default Math.random) so tests can pass a deterministic generator. Every
// numeric field is scaled by (1 + (rng()*2 - 1) * BOT_SKILL_VARIANCE), so a
// fresh rng draw per field spreads same-difficulty bots by up to ~20%.
export function makeBotSkill(difficulty: BotDifficulty, rng: () => number = Math.random): BotSkill {
    const base = BOT_SKILL_BASE[difficulty] ?? BOT_SKILL_BASE[BotDifficulty.MEDIUM]
    const vary = (value: number) => value * (1 + (rng() * 2 - 1) * BOT_SKILL_VARIANCE)
    return {
        aimJitter: vary(base.aimJitter),
        fireRange: vary(base.fireRange),
        fireAimTolerance: vary(base.fireAimTolerance),
        desiredRange: vary(base.desiredRange),
        rangeBand: vary(base.rangeBand),
        reactionTicks: vary(base.reactionTicks),
    }
}

export type BotTarget = {
    target: PipPlayer,
    distance: number,
    angle: number,
}

// Find the nearest spawned enemy of `bot` (a different, spawned player). Targets
// the NEAREST one with NO bot-vs-human priority: a bot fights whoever is closest,
// real player or bot alike, so a mixed room behaves consistently. Pure +
// testable: no mutation, returns the target plus the geometry the brain needs.
export function findNearestEnemy(bot: PipPlayer, players: PipPlayer[]): BotTarget | undefined{
    const botX = bot.ship.physics.position.x
    const botY = bot.ship.physics.position.y

    let best: BotTarget | undefined

    for(const other of players){
        if(other === bot) continue
        if(other.spawned === false) continue

        const dx = other.ship.physics.position.x - botX
        const dy = other.ship.physics.position.y - botY
        const distance = Math.sqrt(dx * dx + dy * dy)
        const angle = Math.atan2(dy, dx)

        if(typeof best === "undefined" || distance < best.distance){
            best = { target: other, distance, angle }
        }
    }

    return best
}

// Compute the inputs a bot should hold this tick, given its current target (or
// undefined if it has none). Pure: depends only on the bot's ship position and
// the target geometry, so it is unit-testable without a running game.
//
// Rules (a small, clear set):
//  - No target  -> hold still, do not fire.
//  - Aim straight at the target.
//  - Far  (> range + band): approach (move along the aim line).
//  - Near (< range - band): back off (move directly away).
//  - Mid  (within the band): strafe perpendicular so the bot keeps moving and
//    feels alive instead of parking on top of the target.
//  - Fire when within fireRange and aimed within fireAimTolerance.
//
// Each numeric threshold is read from bot.skill when present, FALLING BACK to
// the BOT_* constants when it is undefined (a plain bot, e.g. the existing pure
// tests), so legacy call sites keep their original behaviour. aimNoise (default
// 0) is added to the aim this tick: updateBotInputs feeds in a per-tick error
// from the bot's aimJitter, while tests that omit it see an exact aim.
//
// nav (optional) carries the pathfinding context. When it is OMITTED (every
// existing pure test, which runs in a wall-free arena) the bot behaves exactly
// as before: it always steers straight at the target. When nav IS supplied the
// bot first checks line of sight to the target - with a clear lane it STILL
// steers straight at the target (same movementAngle as before), and only when
// the lane is BLOCKED does it follow its cached A* path, steering toward the
// next waypoint. AIM always points at the real target either way.
export function computeBotInputs(bot: PipPlayer, found: BotTarget | undefined, aimNoise = 0, nav?: BotNavContext, aimBase?: number): PlayerInputs{
    const inputs: PlayerInputs = {
        movementAngle: bot.inputs.movementAngle,
        movementAmount: 0,
        aimRotation: bot.inputs.aimRotation,
        useWeapon: false,
        useTactical: false,
        doReload: false,
        spawn: false,
    }

    if(typeof found === "undefined") return inputs

    const { distance, angle } = found

    // Per-bot skill thresholds, falling back to the shared BOT_* constants when a
    // bot has no profile (so the existing pure tests, which pass plain bots, are
    // unchanged).
    const skill = bot.skill
    const desiredRange = skill?.desiredRange ?? BOT_DESIRED_RANGE
    const rangeBand = skill?.rangeBand ?? BOT_RANGE_BAND
    const fireRange = skill?.fireRange ?? BOT_FIRE_RANGE
    const fireAimTolerance = skill?.fireAimTolerance ?? BOT_FIRE_AIM_TOLERANCE

    // The angle the bot AIMS at. Defaults to the true target angle (so the pure
    // tests aim exactly), but updateBotInputs passes a PERCEIVED angle that lags
    // the target by the bot's reaction time, so a bot cannot perfectly track a
    // moving target. The per-tick wandering aim error (aimNoise, 0 by default) is
    // added on top so the shot also spreads. MOVEMENT still uses the true angle.
    const aim = typeof aimBase === "number" ? aimBase : angle
    inputs.aimRotation = aim + aimNoise

    // Decide whether the lane to the target is clear. With no nav context (the
    // wall-free pure tests) the lane is treated as clear, so behaviour is
    // unchanged. When a path waypoint is being followed, `approachAngle` points
    // at the waypoint instead of straight at the target; the close/strafe logic
    // still keys off the true target geometry so range-keeping is unchanged.
    const botX = bot.ship.physics.position.x
    const botY = bot.ship.physics.position.y
    const targetX = found.target.ship.physics.position.x
    const targetY = found.target.ship.physics.position.y

    let lineOfSight = true
    if(typeof nav !== "undefined"){
        lineOfSight = hasLineOfSight(botX, botY, targetX, targetY, nav.rectWalls, nav.segWalls)
    }

    // The angle the bot moves ALONG when closing the gap: straight at the target
    // when the lane is clear (or no nav), or toward the next path waypoint when
    // the lane is blocked. waypointAngle returns the target angle when there is no
    // usable path so the bot still nudges toward the target instead of freezing.
    const approachAngle = lineOfSight === true
        ? angle
        : nextWaypointAngle(bot, botX, botY, angle)

    if(distance > desiredRange + rangeBand){
        // Too far: close the gap (along the path when routing).
        inputs.movementAngle = approachAngle
        inputs.movementAmount = 1
    } else if(distance < desiredRange - rangeBand){
        // Too close: retreat directly away from the target.
        inputs.movementAngle = angle + Math.PI
        inputs.movementAmount = 1
    } else if(lineOfSight === true){
        // In the sweet spot WITH a clear lane: orbit/strafe perpendicular to the
        // target line (the original, unchanged behaviour).
        inputs.movementAngle = angle + Math.PI / 2
        inputs.movementAmount = 0.6
    } else{
        // In range but the wall is between us: keep closing along the path toward
        // a clear shot rather than strafing into the wall.
        inputs.movementAngle = approachAngle
        inputs.movementAmount = 1
    }

    // Reload while we have no shot lined up so we are not caught empty.
    if(bot.ship.weaponEmpty === true){
        inputs.doReload = true
    }

    // Fire when the ship is settled on the bot's ACTUAL aim (inputs.aimRotation =
    // the lagged + wandered angle), NOT the true target. So the bullet flies along
    // that off-centre aim and genuinely misses, instead of the old behaviour where
    // the bot waited to align on the true target and always hit. A wider tolerance
    // (EASY) lets it fire while less settled; a tight one (HARD) waits for a clean
    // shot. Trigger RATE is limited separately in updateBotInputs.
    const aimedWithinTolerance = Math.abs(radianDifference(inputs.aimRotation, bot.ship.rotation)) <= fireAimTolerance
    if(distance <= fireRange && aimedWithinTolerance === true){
        inputs.useWeapon = true
        // Also lob the tactical/grenade when one is ready. The tactical's own
        // ammo + cooldown (shootTactical) rate-limits it, so gating on
        // canUseTactical is enough — no separate brain timer needed.
        if(bot.ship.canUseTactical === true){
            inputs.useTactical = true
        }
    }

    return inputs
}

// The heading from the bot toward the FIRST still-relevant waypoint on its
// cached path, dropping any waypoints it has already reached. Falls back to
// `fallbackAngle` (the direct angle to the target) when the bot has no usable
// path, so a routing bot that has run out of waypoints (or never got one) still
// nudges toward the target rather than freezing. Mutates bot.path only by
// shifting off reached waypoints - cheap, no allocation.
function nextWaypointAngle(bot: PipPlayer, botX: number, botY: number, fallbackAngle: number){
    const path = bot.path
    if(typeof path === "undefined" || path.length === 0) return fallbackAngle

    // Drop every leading waypoint the bot has already arrived at, so it always
    // aims at the next corner ahead of it.
    while(path.length > 0){
        const wp = path[0]
        const dx = wp.x - botX
        const dy = wp.y - botY
        if(dx * dx + dy * dy <= PATH_WAYPOINT_REACHED * PATH_WAYPOINT_REACHED){
            path.shift()
            continue
        }
        return Math.atan2(dy, dx)
    }
    return fallbackAngle
}

// Recompute (and cache on the bot) the A* route around walls toward its target,
// but only when allowed: the per-bot cooldown has elapsed OR the target has
// moved to a different grid cell since the last route. This is the ONLY place
// A* runs, and it is gated so it fires at most ~twice a second per bot, never
// per tick. Does nothing when the lane is already clear - a bot with line of
// sight does not need (and should not pay for) a path. Pure aside from updating
// the bot's cached path fields.
function maybeRecomputePath(bot: PipPlayer, found: BotTarget, nav: BotNavContext){
    const botX = bot.ship.physics.position.x
    const botY = bot.ship.physics.position.y
    const targetX = found.target.ship.physics.position.x
    const targetY = found.target.ship.physics.position.y

    // Clear lane -> no path needed; drop any stale route so the bot steers
    // straight (and the next blocked moment recomputes fresh).
    if(hasLineOfSight(botX, botY, targetX, targetY, nav.rectWalls, nav.segWalls)){
        bot.path = undefined
        bot.pathCooldown = 0
        bot.pathTargetCol = -1
        bot.pathTargetRow = -1
        return
    }

    const goalCell = worldToCell(nav.grid, targetX, targetY)
    const targetMovedCell = goalCell.col !== bot.pathTargetCol || goalCell.row !== bot.pathTargetRow
    const cooldownReady = bot.pathCooldown <= 0
    const noPath = typeof bot.path === "undefined" || bot.path.length === 0

    if(cooldownReady === false && targetMovedCell === false && noPath === false) return

    const path: NavPoint[] = findPath(
        nav.grid,
        botX, botY,
        targetX, targetY,
        nav.rectWalls, nav.segWalls,
    )
    // findPath drops the start cell-centre implicitly via smoothing, but the
    // first waypoint can still sit on top of the bot; nextWaypointAngle skips any
    // already-reached waypoint, so an empty result just falls back to a direct
    // nudge. Store whatever we got (possibly empty -> graceful fallback).
    bot.path = path.length > 0 ? path : undefined
    bot.pathCooldown = PATH_RECOMPUTE_TICKS
    bot.pathTargetCol = goalCell.col
    bot.pathTargetRow = goalCell.row
}

// Maximum reaction lag we buffer target positions for (ticks). Bounds the per-bot
// aim-history ring buffer; a skill's reactionTicks above this is clamped.
export const MAX_REACTION_TICKS = 5

// The angle from the bot to where its target was ~reactionTicks ago, simulating
// human reaction lag (bots run on the server with zero latency, so without this
// they track a target instantly and perfectly). Keeps a small per-bot ring buffer
// of the target's recent positions, reset when the target changes. With no skill /
// zero reaction (plain bots + the pure tests) it returns the LIVE angle, so
// behaviour there is unchanged. Mutates the bot's aim-history buffer only.
function perceivedAimAngle(bot: PipPlayer, found: BotTarget): number {
    const reaction = bot.skill?.reactionTicks ?? 0
    if(reaction <= 0) return found.angle

    const botX = bot.ship.physics.position.x
    const botY = bot.ship.physics.position.y
    const targetX = found.target.ship.physics.position.x
    const targetY = found.target.ship.physics.position.y

    // A new target starts with a clean buffer so the bot never aims at the
    // previous target's stale position.
    if(bot.aimTargetId !== found.target.id){
        bot.aimTargetId = found.target.id
        bot.aimHistory = []
    }
    if(typeof bot.aimHistory === "undefined") bot.aimHistory = []
    const history = bot.aimHistory

    history.push({ x: targetX, y: targetY })
    while(history.length > MAX_REACTION_TICKS + 1) history.shift()

    // The buffered position `reaction` ticks back, clamped to what we have so far.
    const delay = Math.min(Math.round(reaction), MAX_REACTION_TICKS)
    const index = Math.max(0, history.length - 1 - delay)
    const past = history[index]
    return Math.atan2(past.y - botY, past.x - botX)
}

// Advance the bot's wandering aim error one tick: a slow random walk within
// [-jitter, jitter], NOT per-tick white noise (white noise averages to zero so
// the ship stays centred and the shot still lands). The walk keeps the ship
// pointed off-centre for a while, so the bot genuinely misses. Plain bots
// (jitter 0) get 0.
function nextAimBias(bot: PipPlayer, jitter: number, rng: () => number): number {
    if(jitter <= 0){
        bot.aimBias = 0
        return 0
    }
    const step = (rng() * 2 - 1) * jitter * 0.5
    bot.aimBias = Math.max(-jitter, Math.min(jitter, (bot.aimBias ?? 0) + step))
    return bot.aimBias
}

// Ticks a bot must wait after a shot before firing again. Derived from its
// reaction time (floored so even HARD has a small gap), so harder bots shoot
// more often. No skill profile -> 0 (plain bots / pure tests fire freely).
function fireIntervalTicks(bot: PipPlayer): number {
    const reaction = bot.skill?.reactionTicks ?? 0
    if(reaction <= 0) return 0
    return Math.max(2, Math.round(reaction * FIRE_INTERVAL_PER_REACTION))
}

// Drive one bot for this tick: pick a target, compute inputs, write them onto
// the bot. Called by the game loop for every isBot player when calculateAi is
// on. Copies field-by-field (not a reference swap) so the bot keeps its single
// inputs object, matching how consumeQueuedInput mutates a real player's.
//
// nav (optional) is the pathfinding context built once per tick by the caller
// (the cached nav grid + map walls + current tick). When omitted - e.g. the
// existing pure ai tests - the bot behaves exactly as before (always steers
// straight at its target).
//
// PERFORMANCE: the heavy decision (re-target + re-path) runs on a CADENCE
// (AI_DECISION_TICKS), holding the movement intent between decisions; AIM is
// refreshed EVERY tick so the bot stays responsive. The path itself recomputes
// at most every PATH_RECOMPUTE_TICKS inside maybeRecomputePath. Together these
// keep the bot loop from doing real work on most ticks.
export function updateBotInputs(bot: PipPlayer, players: PipPlayer[], rng: () => number = Math.random, nav?: BotNavContext){
    const jitter = bot.skill?.aimJitter ?? 0
    const aimNoise = nextAimBias(bot, jitter, rng)

    // The path-recompute + fire cooldowns tick down once per call so their
    // cadences are measured in real ticks regardless of the decision cadence.
    if(bot.pathCooldown > 0) bot.pathCooldown--
    if(bot.fireCooldown > 0) bot.fireCooldown--

    // CADENCE: only re-run the full decision (target + path + movement intent)
    // every AI_DECISION_TICKS. On the in-between ticks we keep the held movement
    // intent and just refresh aim toward the last-known target heading. With no
    // nav context (pure tests) we always run the full decision so behaviour is
    // identical to before.
    const fullDecision = typeof nav === "undefined" || bot.aiDecisionCooldown <= 0

    if(fullDecision === false){
        // Between decisions: keep movement intent, only re-aim at the current
        // nearest enemy (lagged by reaction time + wandering error) so the bot
        // tracks a moving target imperfectly, like a human would. Hold FIRE between
        // decisions so the trigger is not pinned every tick (the trigger only
        // pulls on a full-decision tick, gated by the fire cooldown).
        bot.aiDecisionCooldown--
        bot.inputs.useWeapon = false
        bot.inputs.useTactical = false
        const quick = findNearestEnemy(bot, players)
        if(typeof quick !== "undefined"){
            bot.inputs.aimRotation = perceivedAimAngle(bot, quick) + aimNoise
        }
        return
    }

    bot.aiDecisionCooldown = AI_DECISION_TICKS

    const found = findNearestEnemy(bot, players)

    // Refresh the A* route (gated internally) before computing movement, so the
    // brain steers along an up-to-date path when the lane is blocked.
    if(typeof nav !== "undefined" && typeof found !== "undefined"){
        maybeRecomputePath(bot, found, nav)
    } else if(typeof found === "undefined"){
        bot.path = undefined
    }

    // The reaction-lagged aim base (where the bot THINKS the target is) plus the
    // wandering error so an EASY bot's shots lag + spread and a HARD bot's stay
    // tight and current. With no target, computeBotInputs ignores aimBase.
    const aimBase = typeof found !== "undefined" ? perceivedAimAngle(bot, found) : undefined
    const next = computeBotInputs(bot, found, aimNoise, nav, aimBase)

    // Trigger discipline: when the brain wants to fire, only actually pull the
    // trigger if the per-bot fire cooldown has elapsed, then start a fresh one. So
    // the bot shoots in human bursts instead of a continuous machine-gun stream.
    let fire = next.useWeapon
    let tactical = next.useTactical
    if(fire === true){
        if(bot.fireCooldown > 0){
            fire = false
            tactical = false
        } else{
            bot.fireCooldown = fireIntervalTicks(bot)
        }
    }

    bot.inputs.movementAngle = next.movementAngle
    bot.inputs.movementAmount = next.movementAmount
    bot.inputs.aimRotation = next.aimRotation
    bot.inputs.useWeapon = fire
    bot.inputs.useTactical = tactical
    bot.inputs.doReload = next.doReload
}
