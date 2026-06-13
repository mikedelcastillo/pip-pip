import { Vector2 } from "@pip-pip/core/src/physics"
import { generateId } from "@pip-pip/core/src/lib/utils"

import { PipPlayer } from "./player"
import { PipPipGame } from "."

// Instant-effect map pickups. Extensible union: add timed buffs (haste/shield)
// later by extending this type and the effect switch in applyPowerupEffect.
export type PowerupType = "health" | "ammo"

// Wire mapping for PowerupType. The powerupSpawn packet carries the type as a
// uint8; this is the single source of truth both sides share so a client can
// reverse it. Append new types here (server + client read the same table).
export const POWERUP_TYPE_TO_CODE: Record<PowerupType, number> = {
    health: 0,
    ammo: 1,
}

export const POWERUP_CODE_TO_TYPE: Record<number, PowerupType> = {
    0: "health",
    1: "ammo",
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

// Apply a powerup's instant effect to a player's ship. Single decision point so
// new types slot in here (add a branch; e.g. timed haste/shield later).
// Server-authoritative callers gate this (see PipPipGame.pickupPowerup); this
// function itself only mutates the ship.
export function applyPowerupEffect(type: PowerupType, player: PipPlayer){
    const ship = player.ship
    if(type === "health"){
        ship.capacities.health = Math.min(ship.maxHealth, ship.capacities.health + POWERUP_HEALTH_AMOUNT)
    } else if(type === "ammo"){
        ship.capacities.weapon = ship.stats.weapon.capacity
        ship.capacities.tactical = ship.stats.tactical.capacity
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
