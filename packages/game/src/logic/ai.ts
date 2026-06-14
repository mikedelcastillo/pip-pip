import { radianDifference } from "@pip-pip/core/src/math"
import { PointPhysicsRectWall, PointPhysicsSegmentWall } from "@pip-pip/core/src/physics"
import { PipPlayer, PlayerInputs } from "./player"
import { NavGrid, NavPoint, avoidWallsHeading, escapeHeading, findPath, hasLineOfSight, updateStuckTicks, worldToCell, ESCAPE_BURST_TICKS } from "./pathfinding"
import { Powerup, PowerupType } from "./powerup"

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

// How close (world units) a powerup must be for a bot to consider a detour for
// it. A health pickup is worth a longer walk when the bot is hurt, so the seek
// range is generous; a buff/ammo pickup is only grabbed when it is nearly on the
// way (BOT_POWERUP_GRAB_RANGE), so the bot never abandons a fight to wander off
// after a far buff.
export const BOT_POWERUP_SEEK_RANGE = 800
// A non-health powerup (ammo / buff) is only worth a detour when it is this close
// - "basically on the way" - so the bot opportunistically scoops it instead of
// trekking across the map for it.
export const BOT_POWERUP_GRAB_RANGE = 450
// A bot only wants a HEALTH pickup when its ship health has dropped to at most
// this fraction of its max. Above this it is healthy enough that chasing the
// enemy is the better use of the tick.
export const BOT_POWERUP_HEALTH_FRACTION = 0.6

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

// What a bot has decided to chase this tick. "enemy" is the default: behave
// exactly as today (approach + orbit + shoot the nearest enemy). "powerup" means
// the bot has found a nearby pickup worth a detour: it MOVES toward the powerup
// (routing around walls just like toward an enemy) while still aiming + firing at
// the nearest enemy if one is in range.
export type BotGoal =
    | { kind: "enemy" }
    | { kind: "powerup", powerup: Powerup, distance: number, angle: number }

// Is a given powerup type worth grabbing for this bot right now? A "health"
// pickup is only wanted when the bot's ship is hurt (at/below
// BOT_POWERUP_HEALTH_FRACTION of max), and only within BOT_POWERUP_SEEK_RANGE.
// Everything else (ammo + timed buffs) is grabbed opportunistically, but only
// when it is nearly on the way (within BOT_POWERUP_GRAB_RANGE) so the bot never
// treks across the map for it. Pure: reads ship health + the distance only.
function powerupWorth(bot: PipPlayer, type: PowerupType, distance: number): boolean{
    if(type === "health"){
        if(distance > BOT_POWERUP_SEEK_RANGE) return false
        const ship = bot.ship
        const maxHealth = ship.maxHealth
        if(maxHealth <= 0) return false
        return ship.capacities.health <= maxHealth * BOT_POWERUP_HEALTH_FRACTION
    }
    // Ammo + timed buffs: only worth a SHORT detour.
    return distance <= BOT_POWERUP_GRAB_RANGE
}

// Decide whether the bot should chase its current enemy or detour to a nearby
// powerup. Pure + deterministic: given the same bot position, enemy and powerup
// list it always returns the same goal, so it is unit-testable with no rng and
// no running game. Picks the NEAREST worthwhile powerup (see powerupWorth); if
// none is worthwhile it falls back to the enemy, so with no powerups (or only
// far/worthless ones) the bot behaves exactly as before. `enemy` may be
// undefined (no enemy in the room) - the bot can still go for a powerup.
export function chooseBotGoal(bot: PipPlayer, enemy: BotTarget | undefined, powerups: Powerup[]): BotGoal{
    const botX = bot.ship.physics.position.x
    const botY = bot.ship.physics.position.y

    let best: { powerup: Powerup, distance: number, angle: number } | undefined

    for(const powerup of powerups){
        if(powerup.dead === true) continue

        const dx = powerup.position.x - botX
        const dy = powerup.position.y - botY
        const distance = Math.sqrt(dx * dx + dy * dy)

        if(powerupWorth(bot, powerup.type, distance) === false) continue

        if(typeof best === "undefined" || distance < best.distance){
            best = { powerup, distance, angle: Math.atan2(dy, dx) }
        }
    }

    if(typeof best !== "undefined"){
        return { kind: "powerup", powerup: best.powerup, distance: best.distance, angle: best.angle }
    }

    return { kind: "enemy" }
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
//
// goal (optional, default "enemy") lets the brain send the bot to a nearby
// powerup instead of orbiting the enemy. When goal.kind === "powerup" the bot
// MOVES toward the powerup (routing around walls via the same nav/path logic,
// keyed to the powerup instead of the enemy) while it STILL aims + fires at the
// nearest enemy if one is in range. With no goal (or kind "enemy") the bot
// behaves exactly as before, so every existing call site is unaffected.
export function computeBotInputs(bot: PipPlayer, found: BotTarget | undefined, aimNoise = 0, nav?: BotNavContext, aimBase?: number, goal: BotGoal = { kind: "enemy" }): PlayerInputs{
    const inputs: PlayerInputs = {
        movementAngle: bot.inputs.movementAngle,
        movementAmount: 0,
        aimRotation: bot.inputs.aimRotation,
        useWeapon: false,
        useTactical: false,
        doReload: false,
        spawn: false,
    }

    // With no enemy AND no powerup to seek there is nothing to do: hold still and
    // hold fire, exactly as before. A powerup goal still drives movement below
    // even when there is no enemy (the bot can grab a pickup in an empty room).
    if(typeof found === "undefined" && goal.kind !== "powerup") return inputs

    const { distance, angle } = found ?? { distance: Infinity, angle: 0 }

    // Per-bot skill thresholds, falling back to the shared BOT_* constants when a
    // bot has no profile (so the existing pure tests, which pass plain bots, are
    // unchanged).
    const skill = bot.skill
    const desiredRange = skill?.desiredRange ?? BOT_DESIRED_RANGE
    const rangeBand = skill?.rangeBand ?? BOT_RANGE_BAND
    const fireRange = skill?.fireRange ?? BOT_FIRE_RANGE
    const fireAimTolerance = skill?.fireAimTolerance ?? BOT_FIRE_AIM_TOLERANCE

    // The angle the bot AIMS at. Defaults to the true enemy angle (so the pure
    // tests aim exactly), but updateBotInputs passes a PERCEIVED angle that lags
    // the enemy by the bot's reaction time, so a bot cannot perfectly track a
    // moving target. The per-tick wandering aim error (aimNoise, 0 by default) is
    // added on top so the shot also spreads. With NO enemy (powerup-only goal in
    // an empty room) the held aim is kept untouched. AIM always tracks the enemy,
    // never the powerup the bot is walking toward.
    if(typeof found !== "undefined"){
        const aim = typeof aimBase === "number" ? aimBase : angle
        inputs.aimRotation = aim + aimNoise
    }

    const botX = bot.ship.physics.position.x
    const botY = bot.ship.physics.position.y

    // The point the bot MOVES toward: the powerup when seeking one, otherwise the
    // enemy. The same nav/path routing is reused either way, so a bot routes
    // around walls toward a powerup exactly as it does toward an enemy.
    const seekingPowerup = goal.kind === "powerup"
    // Check goal.kind DIRECTLY in each ternary (not via the aliased seekingPowerup
    // bool): the client compiles with an older TypeScript that does not narrow a
    // discriminated union through an aliased condition, so goal.powerup/goal.angle
    // would not type-check there. The direct check narrows on every TS version.
    const moveTargetX = goal.kind === "powerup" ? goal.powerup.position.x : (found?.target.ship.physics.position.x ?? botX)
    const moveTargetY = goal.kind === "powerup" ? goal.powerup.position.y : (found?.target.ship.physics.position.y ?? botY)
    const moveAngle = goal.kind === "powerup" ? goal.angle : angle

    // Decide whether the lane to the MOVE target is clear. With no nav context
    // (the wall-free pure tests) the lane is treated as clear, so behaviour is
    // unchanged. When a path waypoint is being followed, `approachAngle` points
    // at the waypoint instead of straight at the move target.
    let lineOfSight = true
    if(typeof nav !== "undefined"){
        lineOfSight = hasLineOfSight(botX, botY, moveTargetX, moveTargetY, nav.rectWalls, nav.segWalls)
    }

    // The angle the bot moves ALONG when closing the gap: straight at the move
    // target when the lane is clear (or no nav), or toward the next path waypoint
    // when the lane is blocked. nextWaypointAngle returns the move angle when there
    // is no usable path so the bot still nudges toward the move target instead of
    // freezing.
    const approachAngle = lineOfSight === true
        ? moveAngle
        : nextWaypointAngle(bot, botX, botY, moveAngle)

    // Whether THIS tick's movement is the bot TRAVELLING toward a destination
    // (closing on the move target, or following the A* path around a wall) versus
    // merely holding station (orbiting/strafing at its desired range). Only a
    // travelling bot can genuinely WEDGE against a wall on the way somewhere, so
    // only this drives the stuck detector (see applyStuckEscape). An orbiting bot
    // makes little net headway by design, so treating it as a stuck candidate
    // false-positived into the "wiggle in place" regression. Retreat is excluded
    // too: it drives directly AWAY from the target, never into a wall ahead of it.
    let traveling = false
    if(seekingPowerup === true){
        // Going for a powerup: drive straight at it (along the path when routing).
        // No orbit/retreat here - the bot WANTS to touch the pickup, so it closes
        // all the way in while it keeps shooting the enemy below.
        inputs.movementAngle = approachAngle
        inputs.movementAmount = 1
        traveling = true
    } else if(distance > desiredRange + rangeBand){
        // Too far: close the gap (along the path when routing).
        inputs.movementAngle = approachAngle
        inputs.movementAmount = 1
        traveling = true
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
        traveling = true
    }

    // Record the travel intent so applyStuckEscape (which can run on a later
    // held-intent tick) only treats the bot as a stuck candidate when it was
    // actually trying to travel, never when it is intentionally orbiting.
    bot.botTraveling = traveling

    // Reload while we have no shot lined up so we are not caught empty.
    if(bot.ship.weaponEmpty === true){
        inputs.doReload = true
    }

    // Fire when the ship is settled on the bot's ACTUAL aim (inputs.aimRotation =
    // the lagged + wandered angle), NOT the true target. So the bullet flies along
    // that off-centre aim and genuinely misses, instead of the old behaviour where
    // the bot waited to align on the true target and always hit. A wider tolerance
    // (EASY) lets it fire while less settled; a tight one (HARD) waits for a clean
    // shot. Trigger RATE is limited separately in updateBotInputs. Firing is keyed
    // to the ENEMY's distance, so a bot detouring for a powerup still shoots an
    // enemy that comes into range.
    const aimedWithinTolerance = Math.abs(radianDifference(inputs.aimRotation, bot.ship.rotation)) <= fireAimTolerance
    if(typeof found !== "undefined" && distance <= fireRange && aimedWithinTolerance === true){
        inputs.useWeapon = true
        // Also lob the tactical/grenade when one is ready. The tactical's own
        // ammo + cooldown (shootTactical) rate-limits it, so gating on
        // canUseTactical is enough - no separate brain timer needed.
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

// Recompute (and cache on the bot) the A* route around walls toward a target
// WORLD POINT, but only when allowed: the per-bot cooldown has elapsed OR the
// target has moved to a different grid cell since the last route. This is the
// ONLY place A* runs, and it is gated so it fires at most ~twice a second per
// bot, never per tick. Does nothing when the lane is already clear - a bot with
// line of sight does not need (and should not pay for) a path. The target point
// is the ENEMY when chasing and the POWERUP when seeking one, so the same
// routing serves both goals. Pure aside from updating the bot's cached path
// fields.
function maybeRecomputePath(bot: PipPlayer, targetX: number, targetY: number, nav: BotNavContext){
    const botX = bot.ship.physics.position.x
    const botY = bot.ship.physics.position.y

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

    // No route to the target (sealed off, or wedged inside a wall): rather than
    // press straight into the wall along the direct fallback angle, open an escape
    // burst so applyStuckEscape steers the bot toward the nearest open cell / back
    // the way it came. Cheap + additive: just primes the existing escape counter.
    if(path.length === 0 && bot.escapeTicks <= 0){
        bot.escapeTicks = ESCAPE_BURST_TICKS
    }
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

// Robust unstick step, run EVERY tick a bot has a nav context. It tracks the
// bot's recent progress and, when the bot has been TRAVELLING toward a
// destination yet barely advancing (wedged into a wall pocket), it overrides
// this tick's movement to steer at the nearest open nav cell for a short burst
// until the bot is free. Otherwise it applies a gentle local wall-avoidance
// nudge so a bot following a waypoint skims along a wall instead of grinding
// into the corner. Returns with the bot's movement inputs possibly rewritten;
// aim/fire are never touched.
//
// CRUCIAL: only a TRAVELLING bot (bot.botTraveling, set by computeBotInputs when
// it is closing on its target / following the path) is a stuck candidate. A bot
// orbiting/strafing at its desired range makes little net headway BY DESIGN, so
// gating on raw "wants to move" false-positived it as stuck and opened an escape
// burst every few ticks - the bot then jittered between orbit and escape and
// "wiggled in place" instead of chasing. Gating on the travel intent fixes that
// while a genuine wall-wedge (which only happens WHILE travelling) still recovers.
//
// Called only with a nav context, so a plain bot (no nav - the pure tests) never
// reaches here and behaves exactly as before. Pure aside from updating the bot's
// stuck/escape counters + the movement inputs it is meant to steer.
function applyStuckEscape(bot: PipPlayer, nav: BotNavContext){
    const botX = bot.ship.physics.position.x
    const botY = bot.ship.physics.position.y

    // The bot is a stuck candidate only while it is TRAVELLING toward a
    // destination (approaching / path-following), never while orbiting, retreating
    // or parked. An orbiting bot legitimately holds station, so feeding its intent
    // to the detector would false-positive it as wedged - the regression we fix.
    const traveling = bot.botTraveling === true

    // Measure NET progress against where the bot was when the stuck WINDOW opened
    // (lastStuckX/Y is the window origin, NOT just last tick), so a bot that is
    // ramping up or weaving still counts the ground it covers across the window
    // rather than being judged on one slow tick. updateStuckTicks accumulates the
    // counter while the bot stays within the progress threshold of that origin and
    // resets it the instant the bot travels far enough or stops TRAVELLING.
    const progress = updateStuckTicks(
        nav.grid,
        bot.lastStuckX, bot.lastStuckY,
        botX, botY,
        traveling,
        bot.stuckTicks,
    )
    bot.stuckTicks = progress.stuckTicks
    // Re-anchor the window origin only when the counter has RESET (progress made,
    // or the bot stopped travelling). While the counter is climbing the origin
    // stays put so net displacement is measured over the whole window, not per
    // tick - the mis-scaled per-tick window was why a freely chasing bot in a
    // coarse grid read as permanently stuck.
    if(progress.stuckTicks === 0){
        bot.lastStuckX = botX
        bot.lastStuckY = botY
    }

    // Newly stuck -> open an escape burst and force a fresh path next decision so
    // the bot does not keep following the route that drove it into the pocket.
    if(progress.stuck === true && bot.escapeTicks <= 0){
        bot.escapeTicks = ESCAPE_BURST_TICKS
        bot.stuckTicks = 0
        bot.pathCooldown = 0
    }

    if(bot.escapeTicks > 0){
        // Steer straight at the nearest open cell, overriding the normal target
        // steering, at full throttle. escapeHeading is undefined when the bot is
        // already on an open cell - i.e. it is no longer wedged, so we END the
        // burst at once and let normal chasing resume instead of burning the whole
        // burst steering nowhere. This keeps the escape BRIEF and stops it ever
        // suppressing a bot that has already freed itself.
        const heading = escapeHeading(nav.grid, botX, botY)
        if(typeof heading === "number"){
            bot.escapeTicks--
            bot.inputs.movementAngle = heading
            bot.inputs.movementAmount = 1
            return
        }
        bot.escapeTicks = 0
    }

    // Not escaping: when the bot still wants to move, ease its heading off any
    // immediately-adjacent wall so it stops grinding into a corner while chasing a
    // waypoint. A no-op in open space (avoidWallsHeading returns the input angle).
    if(bot.inputs.movementAmount > 0){
        bot.inputs.movementAngle = avoidWallsHeading(nav.grid, botX, botY, bot.inputs.movementAngle)
    }
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
// powerups (optional, default empty) are the active map pickups the bot may
// detour for. The caller passes game.powerups.getActive(); chooseBotGoal then
// decides per decision tick whether a nearby pickup is worth more than chasing
// the enemy. Defaulted to [] so every existing call site / test is unaffected
// and behaves exactly as before (no powerups -> always the enemy goal).
//
// PERFORMANCE: the heavy decision (re-target + re-path) runs on a CADENCE
// (AI_DECISION_TICKS), holding the movement intent between decisions; AIM is
// refreshed EVERY tick so the bot stays responsive. The path itself recomputes
// at most every PATH_RECOMPUTE_TICKS inside maybeRecomputePath. Together these
// keep the bot loop from doing real work on most ticks.
export function updateBotInputs(bot: PipPlayer, players: PipPlayer[], rng: () => number = Math.random, nav?: BotNavContext, powerups: Powerup[] = []){
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
        // Keep tracking progress + escaping even on held-intent ticks, so a bot
        // wedged BETWEEN decisions still recovers without waiting for the next one.
        // nav is necessarily defined here (fullDecision is false only when it is),
        // but the explicit guard keeps every TS version's narrowing happy.
        if(typeof nav !== "undefined") applyStuckEscape(bot, nav)
        return
    }

    bot.aiDecisionCooldown = AI_DECISION_TICKS

    const found = findNearestEnemy(bot, players)

    // Decide the goal this tick: stick with the enemy, or detour to a nearby
    // worthwhile powerup. Pure + deterministic; with no powerups it always returns
    // the enemy goal so behaviour is unchanged.
    const goal = chooseBotGoal(bot, found, powerups)

    // The world point the bot ROUTES toward: the powerup when seeking one, else
    // the enemy. The same A* routing serves both goals. With neither a target nor
    // a route there is nothing to path to, so drop any stale path.
    let routeX: number | undefined
    let routeY: number | undefined
    if(goal.kind === "powerup"){
        routeX = goal.powerup.position.x
        routeY = goal.powerup.position.y
    } else if(typeof found !== "undefined"){
        routeX = found.target.ship.physics.position.x
        routeY = found.target.ship.physics.position.y
    }

    // Refresh the A* route (gated internally) before computing movement, so the
    // brain steers along an up-to-date path toward its goal when the lane is
    // blocked.
    if(typeof nav !== "undefined" && typeof routeX === "number" && typeof routeY === "number"){
        maybeRecomputePath(bot, routeX, routeY, nav)
    } else if(typeof routeX === "undefined"){
        bot.path = undefined
    }

    // The reaction-lagged aim base (where the bot THINKS the enemy is) plus the
    // wandering error so an EASY bot's shots lag + spread and a HARD bot's stay
    // tight and current. With no enemy, computeBotInputs ignores aimBase.
    const aimBase = typeof found !== "undefined" ? perceivedAimAngle(bot, found) : undefined
    const next = computeBotInputs(bot, found, aimNoise, nav, aimBase, goal)

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

    // Final robustness pass: detect a wedged bot and override movement to steer at
    // the nearest open cell (or just ease off a wall). Runs only with a nav
    // context, so plain bots / pure tests are untouched. Movement-only - the aim +
    // fire decided above are left exactly as they are.
    if(typeof nav !== "undefined"){
        applyStuckEscape(bot, nav)
    }
}
