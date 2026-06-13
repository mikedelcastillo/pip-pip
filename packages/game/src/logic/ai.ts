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

export type BotTarget = {
    target: PipPlayer,
    distance: number,
    angle: number,
}

// Find the nearest spawned enemy of `bot` (a different, spawned player). By
// default bots target non-bot players (real clients) so a room full of bots
// does not just shoot each other; if no human target exists it falls back to
// any other spawned player so two bots will still fight. Pure + testable: no
// mutation, returns the target plus the geometry the brain needs.
export function findNearestEnemy(bot: PipPlayer, players: PipPlayer[]): BotTarget | undefined{
    const botX = bot.ship.physics.position.x
    const botY = bot.ship.physics.position.y

    let best: BotTarget | undefined
    let bestFallback: BotTarget | undefined

    for(const other of players){
        if(other === bot) continue
        if(other.spawned === false) continue

        const dx = other.ship.physics.position.x - botX
        const dy = other.ship.physics.position.y - botY
        const distance = Math.sqrt(dx * dx + dy * dy)
        const angle = Math.atan2(dy, dx)
        const candidate: BotTarget = { target: other, distance, angle }

        if(other.isBot === false){
            if(typeof best === "undefined" || distance < best.distance) best = candidate
        }
        if(typeof bestFallback === "undefined" || distance < bestFallback.distance){
            bestFallback = candidate
        }
    }

    return best ?? bestFallback
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
//  - Fire when within BOT_FIRE_RANGE and aimed within BOT_FIRE_AIM_TOLERANCE.
export function computeBotInputs(bot: PipPlayer, found: BotTarget | undefined): PlayerInputs{
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

    inputs.aimRotation = angle

    if(distance > BOT_DESIRED_RANGE + BOT_RANGE_BAND){
        // Too far: close the gap.
        inputs.movementAngle = angle
        inputs.movementAmount = 1
    } else if(distance < BOT_DESIRED_RANGE - BOT_RANGE_BAND){
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

    const aimedWithinTolerance = Math.abs(radianDifference(angle, bot.ship.rotation)) <= BOT_FIRE_AIM_TOLERANCE
    if(distance <= BOT_FIRE_RANGE && aimedWithinTolerance === true){
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
export function updateBotInputs(bot: PipPlayer, players: PipPlayer[]){
    const found = findNearestEnemy(bot, players)
    const next = computeBotInputs(bot, found)
    bot.inputs.movementAngle = next.movementAngle
    bot.inputs.movementAmount = next.movementAmount
    bot.inputs.aimRotation = next.aimRotation
    bot.inputs.useWeapon = next.useWeapon
    bot.inputs.useTactical = next.useTactical
    bot.inputs.doReload = next.doReload
}
