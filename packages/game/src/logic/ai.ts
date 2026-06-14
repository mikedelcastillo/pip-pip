import { radianDifference } from "@pip-pip/core/src/math"
import { PipPlayer, PlayerInputs } from "./player"

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
export function computeBotInputs(bot: PipPlayer, found: BotTarget | undefined, aimNoise = 0): PlayerInputs{
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

    // Aim at the target, plus this tick's random error (0 by default).
    inputs.aimRotation = angle + aimNoise

    if(distance > desiredRange + rangeBand){
        // Too far: close the gap.
        inputs.movementAngle = angle
        inputs.movementAmount = 1
    } else if(distance < desiredRange - rangeBand){
        // Too close: retreat directly away.
        inputs.movementAngle = angle + Math.PI
        inputs.movementAmount = 1
    } else{
        // In the sweet spot: orbit/strafe perpendicular to the target line.
        inputs.movementAngle = angle + Math.PI / 2
        inputs.movementAmount = 0.6
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

// Drive one bot for this tick: pick a target, compute inputs, write them onto
// the bot. Called by the game loop for every isBot player when calculateAi is
// on. Copies field-by-field (not a reference swap) so the bot keeps its single
// inputs object, matching how consumeQueuedInput mutates a real player's.
export function updateBotInputs(bot: PipPlayer, players: PipPlayer[], rng: () => number = Math.random){
    const found = findNearestEnemy(bot, players)
    // A fresh per-tick aim error sampled from the bot's skill (no profile -> no
    // jitter), passed as aimNoise so an EASY bot's shots wander and a HARD bot's
    // stay tight. rng is injected (default Math.random) so this stays testable.
    const jitter = bot.skill?.aimJitter ?? 0
    const aimNoise = jitter === 0 ? 0 : (rng() * 2 - 1) * jitter
    const next = computeBotInputs(bot, found, aimNoise)
    bot.inputs.movementAngle = next.movementAngle
    bot.inputs.movementAmount = next.movementAmount
    bot.inputs.aimRotation = next.aimRotation
    bot.inputs.useWeapon = next.useWeapon
    bot.inputs.useTactical = next.useTactical
    bot.inputs.doReload = next.doReload
}
