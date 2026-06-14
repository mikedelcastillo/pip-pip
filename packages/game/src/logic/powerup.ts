import { Vector2 } from "@pip-pip/core/src/physics"
import { generateId } from "@pip-pip/core/src/lib/utils"

import { PipPlayer } from "./player"
import { PipPipGame } from "."

// Map pickups. "health"/"ammo" are instant-effect; "haste"/"shield"/"invis"/
// "ricochet"/"rapidfire" are timed buffs applied to the ship's timings (ticked
// down in ship.update). Extend this union plus the effect switch in
// applyPowerupEffect to add more.
export type PowerupType = "health" | "ammo" | "haste" | "shield" | "invis" | "ricochet" | "rapidfire"

// Wire mapping for PowerupType. The powerupSpawn packet carries the type as a
// uint8; this is the single source of truth both sides share so a client can
// reverse it. Append new types here (server + client read the same table). Codes
// stay <= 255 so they keep fitting the $uint8 the packet already uses, so adding
// a type never changes the wire shape.
export const POWERUP_TYPE_TO_CODE: Record<PowerupType, number> = {
    health: 0,
    ammo: 1,
    haste: 2,
    shield: 3,
    invis: 4,
    ricochet: 5,
    rapidfire: 6,
}

export const POWERUP_CODE_TO_TYPE: Record<number, PowerupType> = {
    0: "health",
    1: "ammo",
    2: "haste",
    3: "shield",
    4: "invis",
    5: "ricochet",
    6: "rapidfire",
}

// Powerup ids are exactly POWERUP_ID_LENGTH chars from generateId so they
// round-trip through the $string(POWERUP_ID_LENGTH) serializer untouched (the
// serializer pads/truncates to its fixed length, so the WHOLE id must fit). No
// prefix is used for that reason. 4 chars from the 60-char alphabet is plenty
// to never collide among the handful of powerups alive at once.
export const POWERUP_ID_LENGTH = 4

// Pickup hitbox radius (circle-vs-circle against a ship, like bullet-vs-player).
export const POWERUP_RADIUS = 24

// How much health a "health" pickup restores (capped at the ship's max).
export const POWERUP_HEALTH_AMOUNT = 50

// Timed-buff durations, in ticks (game runs at 20 tps). HASTE/SHIELD/INVIS/
// RICOCHET/RAPIDFIRE are all networked as $uint8 in playerShipTimings, so EVERY
// value here MUST stay <= 255 (the hard uint8 cap) or it wraps on the wire. Tuned
// long enough to feel like a real power window: HASTE ~10s, SHIELD ~8.5s, INVIS
// ~9s, RICOCHET ~10s of bouncing bullets, RAPIDFIRE ~10s of a faster trigger. The
// ricochet bounce itself is still resolved server-side on the (networked)
// bullets; the timer rides the wire so the tactical feed + remote ships know how
// long it has left.
export const HASTE_TICKS = 20 * 10 // 200 ticks (~10s, <= 255)
export const SHIELD_TICKS = 170 // ~8.5s, <= 255
export const INVIS_TICKS = 180 // ~9s, <= 255
export const RICOCHET_TICKS = 20 * 10 // 200 ticks (~10s, <= 255)
export const RAPIDFIRE_TICKS = 20 * 10 // 200 ticks (~10s, <= 255)

// While hasted, movement acceleration (and the speed cap that derives from it)
// is multiplied by this factor. Applied in computeMovementAcceleration so the
// shared client-prediction + server step stay consistent for the local player.
export const HASTE_MULTIPLIER = 1.5

// While rapidfire is active, the weapon-rate cooldown set after each shot is
// multiplied by this factor, so the trigger resets sooner and the gun fires
// noticeably faster. Mirrors HASTE_MULTIPLIER's role (a gated stat modifier),
// but shrinks an interval instead of growing an acceleration, so it is < 1. 0.5
// roughly doubles the fire rate while the buff is up; normal firing is untouched
// when inactive. Applied in PipShip.shoot.
export const RAPIDFIRE_MULTIPLIER = 0.5

// Apply a powerup's effect to a player's ship. Single decision point so new
// types slot in here. Instant types ("health"/"ammo") mutate capacities; timed
// types ("haste"/"shield"/"invis"/"ricochet"/"rapidfire") set a ship timing that
// ticks down in ship.update. Server-authoritative callers gate this (see
// PipPipGame.pickupPowerup); this function itself only mutates the ship.
export function applyPowerupEffect(type: PowerupType, player: PipPlayer){
    const ship = player.ship
    if(type === "health"){
        ship.capacities.health = Math.min(ship.maxHealth, ship.capacities.health + POWERUP_HEALTH_AMOUNT)
    } else if(type === "ammo"){
        ship.capacities.weapon = ship.stats.weapon.capacity
        ship.capacities.tactical = ship.stats.tactical.capacity
    } else if(type === "haste"){
        ship.timings.haste = HASTE_TICKS
    } else if(type === "shield"){
        ship.timings.shield = SHIELD_TICKS
    } else if(type === "invis"){
        ship.timings.invisibility = INVIS_TICKS
    } else if(type === "ricochet"){
        ship.timings.ricochet = RICOCHET_TICKS
    } else if(type === "rapidfire"){
        ship.timings.rapidfire = RAPIDFIRE_TICKS
    }
}

export type PowerupParams = {
    position: Vector2,
    type: PowerupType,
    id?: string,
}

export class Powerup{
    dead = true

    id = generateId(POWERUP_ID_LENGTH)
    type: PowerupType = "health"
    position = new Vector2()
    radius = POWERUP_RADIUS

    pool: PowerupPool

    constructor(pool: PowerupPool){
        this.pool = pool
    }

    set(params: PowerupParams){
        // An incoming networked powerup carries the authoritative id so client
        // and server agree on which entity is which (pickup removal is id-keyed).
        // A server-spawned powerup keeps its locally generated id.
        if(typeof params.id === "string") this.id = params.id
        this.position.x = params.position.x
        this.position.y = params.position.y
        this.type = params.type
        this.dead = false
        this.pool.game.events.emit("powerupSpawn", { powerup: this })
    }

    unset(){
        this.pool.game.events.emit("powerupDespawn", { powerup: this })
        this.dead = true
        this.position.x = 0
        this.position.y = 0
    }
}

export class PowerupPool{
    game: PipPipGame

    powerups: Record<string, Powerup> = {}

    constructor(game: PipPipGame){
        this.game = game
    }

    getAll(){
        return Object.values(this.powerups)
    }

    getActive(){
        return Object.values(this.powerups).filter(powerup => powerup.dead === false)
    }

    new(params: PowerupParams){
        let output: Powerup
        const reusable = this.getAll().find(powerup => powerup.dead === true)

        if(typeof reusable === "undefined"){
            const powerup = new Powerup(this)
            output = powerup
        } else{
            output = reusable
            // A reused slot is re-keyed below to its (possibly networked) id, so
            // drop the stale key first to avoid leaving a dangling entry.
            delete this.powerups[output.id]
        }

        output.set(params)
        this.powerups[output.id] = output
        return output
    }

    unset(powerup: Powerup){
        if(!(powerup.id in this.powerups)) return
        if(powerup.dead === false){
            powerup.unset()
        }
    }

    // Remove by id (used by the client when the server reports a pickup).
    unsetById(id: string){
        const powerup = this.powerups[id]
        if(typeof powerup !== "undefined") this.unset(powerup)
    }

    destroy(){
        for(const id in this.powerups){
            const powerup = this.powerups[id]
            this.unset(powerup)
            delete this.powerups[id]
        }
    }
}
