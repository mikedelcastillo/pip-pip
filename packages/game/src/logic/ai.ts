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
    // Peak per-tick random aim error (radians). HARD aims tighter (small jitter),
    // EASY sprays (large jitter). updateBotInputs samples [-aimJitter, +aimJitter].
    aimJitter: number,
    // The bot only opens fire within this distance of its target.
    fireRange: number,
    // ...and only when its aim is within this many radians of the target.
    fireAimTolerance: number,
    // The range the bot tries to hold (orbit distance), like BOT_DESIRED_RANGE.
    desiredRange: number,
    // Half-width of the strafe band around desiredRange, like BOT_RANGE_BAND.
    rangeBand: number,
}

// Base (pre-variance) skill numbers per difficulty. HARD is accurate + aggressive
// (tiny aimJitter, long fireRange, wide aim tolerance); EASY is sloppy + timid
// (large aimJitter, short fireRange, narrow tolerance). MEDIUM sits on the
// existing BOT_* constants so a MEDIUM bot behaves like today's single profile.
const BOT_SKILL_BASE: Record<BotDifficulty, BotSkill> = {
    [BotDifficulty.EASY]: {
        aimJitter: 0.35,
        fireRange: BOT_FIRE_RANGE * 0.7,
        fireAimTolerance: BOT_FIRE_AIM_TOLERANCE * 0.7,
        desiredRange: BOT_DESIRED_RANGE,
        rangeBand: BOT_RANGE_BAND,
    },
    [BotDifficulty.MEDIUM]: {
        aimJitter: 0.15,
        fireRange: BOT_FIRE_RANGE,
        fireAimTolerance: BOT_FIRE_AIM_TOLERANCE,
        desiredRange: BOT_DESIRED_RANGE,
        rangeBand: BOT_RANGE_BAND,
    },
    [BotDifficulty.HARD]: {
        aimJitter: 0.04,
        fireRange: BOT_FIRE_RANGE * 1.3,
        fireAimTolerance: BOT_FIRE_AIM_TOLERANCE * 1.4,
        desiredRange: BOT_DESIRED_RANGE,
        rangeBand: BOT_RANGE_BAND,
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
export function computeBotInputs(bot: PipPlayer, found: BotTarget | undefined, aimNoise = 0, nav?: BotNavContext): PlayerInputs{
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

    // Aim at the target, plus this tick's random error (0 by default). Aim ALWAYS
    // tracks the real target, even while routing around a wall.
    inputs.aimRotation = angle + aimNoise

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

    const aimedWithinTolerance = Math.abs(radianDifference(angle, bot.ship.rotation)) <= fireAimTolerance
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
    const aimNoise = jitter === 0 ? 0 : (rng() * 2 - 1) * jitter

    // The path-recompute cooldown ticks down once per call so its 0.5s cadence is
    // measured in real ticks regardless of the decision cadence.
    if(bot.pathCooldown > 0) bot.pathCooldown--

    // CADENCE: only re-run the full decision (target + path + movement intent)
    // every AI_DECISION_TICKS. On the in-between ticks we keep the held movement
    // intent and just refresh aim toward the last-known target heading. With no
    // nav context (pure tests) we always run the full decision so behaviour is
    // identical to before.
    const fullDecision = typeof nav === "undefined" || bot.aiDecisionCooldown <= 0

    if(fullDecision === false){
        // Between decisions: keep movement intent, only re-aim at the current
        // nearest enemy so the bot tracks a moving target smoothly.
        bot.aiDecisionCooldown--
        const quick = findNearestEnemy(bot, players)
        if(typeof quick !== "undefined"){
            bot.inputs.aimRotation = quick.angle + aimNoise
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

    // A fresh per-tick aim error sampled from the bot's skill (no profile -> no
    // jitter), passed as aimNoise so an EASY bot's shots wander and a HARD bot's
    // stay tight. rng is injected (default Math.random) so this stays testable.
    const next = computeBotInputs(bot, found, aimNoise, nav)
    bot.inputs.movementAngle = next.movementAngle
    bot.inputs.movementAmount = next.movementAmount
    bot.inputs.aimRotation = next.aimRotation
    bot.inputs.useWeapon = next.useWeapon
    bot.inputs.useTactical = next.useTactical
    bot.inputs.doReload = next.doReload
}
