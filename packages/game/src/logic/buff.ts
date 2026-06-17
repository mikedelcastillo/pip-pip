import { Vector2 } from "@pip-pip/core/src/physics"
import { generateId } from "@pip-pip/core/src/lib/utils"

import { PipPlayer } from "./player"
import { PipPipGame } from "."
import { HASTE_TICKS, SHIELD_TICKS, INVIS_TICKS, RICOCHET_TICKS, RAPIDFIRE_TICKS, MAX_BUFF_TICKS } from "./buff-config"

// Re-export the timed-buff durations so existing importers of this module keep
// working now that the values live in buff-config.
export { HASTE_TICKS, SHIELD_TICKS, INVIS_TICKS, RICOCHET_TICKS, RAPIDFIRE_TICKS } from "./buff-config"

// Map pickups. "health"/"ammo" are instant-effect; "haste"/"shield"/"invis"/
// "ricochet"/"rapidfire" are timed buffs applied to the ship's timings (ticked
// down in ship.update). Extend this union plus the effect switch in
// applyBuffEffect to add more.
export type BuffType = "health" | "ammo" | "haste" | "shield" | "invis" | "ricochet" | "rapidfire"

// Wire mapping for BuffType. The buffSpawn packet carries the type as a
// uint8; this is the single source of truth both sides share so a client can
// reverse it. Append new types here (server + client read the same table). Codes
// stay <= 255 so they keep fitting the $uint8 the packet already uses, so adding
// a type never changes the wire shape.
export const BUFF_TYPE_TO_CODE: Record<BuffType, number> = {
    health: 0,
    ammo: 1,
    haste: 2,
    shield: 3,
    invis: 4,
    ricochet: 5,
    rapidfire: 6,
}

export const BUFF_CODE_TO_TYPE: Record<number, BuffType> = {
    0: "health",
    1: "ammo",
    2: "haste",
    3: "shield",
    4: "invis",
    5: "ricochet",
    6: "rapidfire",
}

// Buff ids are exactly BUFF_ID_LENGTH chars from generateId so they
// round-trip through the $string(BUFF_ID_LENGTH) serializer untouched (the
// serializer pads/truncates to its fixed length, so the WHOLE id must fit). No
// prefix is used for that reason. 4 chars from the 60-char alphabet is plenty
// to never collide among the handful of buffs alive at once.
export const BUFF_ID_LENGTH = 4

// Pickup hitbox radius (circle-vs-circle against a ship, like bullet-vs-player).
export const BUFF_RADIUS = 24

// How much health a "health" pickup restores (capped at the ship's max).
export const BUFF_HEALTH_AMOUNT = 50

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

// Apply a buff's effect to a player's ship. Single decision point so new
// types slot in here. Instant types ("health"/"ammo") mutate capacities; timed
// types ("haste"/"shield"/"invis"/"ricochet"/"rapidfire") now STACK: each pickup
// ADDS its duration to the ship timing that ticks down in ship.update, clamped to
// MAX_BUFF_TICKS so it never overflows the wire. Server-authoritative callers gate
// this (see PipPipGame.pickupBuff); this function itself only mutates the ship.
export function applyBuffEffect(type: BuffType, player: PipPlayer){
    const ship = player.ship
    if(type === "health"){
        ship.capacities.health = Math.min(ship.maxHealth, ship.capacities.health + BUFF_HEALTH_AMOUNT)
    } else if(type === "ammo"){
        ship.capacities.weapon = ship.stats.weapon.capacity
        ship.capacities.tactical = ship.stats.tactical.capacity
    } else if(type === "haste"){
        ship.timings.haste = Math.min(MAX_BUFF_TICKS, ship.timings.haste + HASTE_TICKS)
    } else if(type === "shield"){
        ship.timings.shield = Math.min(MAX_BUFF_TICKS, ship.timings.shield + SHIELD_TICKS)
    } else if(type === "invis"){
        ship.timings.invisibility = Math.min(MAX_BUFF_TICKS, ship.timings.invisibility + INVIS_TICKS)
    } else if(type === "ricochet"){
        ship.timings.ricochet = Math.min(MAX_BUFF_TICKS, ship.timings.ricochet + RICOCHET_TICKS)
    } else if(type === "rapidfire"){
        ship.timings.rapidfire = Math.min(MAX_BUFF_TICKS, ship.timings.rapidfire + RAPIDFIRE_TICKS)
    }
}

export type BuffParams = {
    position: Vector2,
    type: BuffType,
    id?: string,
}

export class Buff{
    dead = true

    id = generateId(BUFF_ID_LENGTH)
    type: BuffType = "health"
    position = new Vector2()
    radius = BUFF_RADIUS

    pool: BuffPool

    constructor(pool: BuffPool){
        this.pool = pool
    }

    set(params: BuffParams){
        // An incoming networked buff carries the authoritative id so client
        // and server agree on which entity is which (pickup removal is id-keyed).
        // A server-spawned buff keeps its locally generated id.
        if(typeof params.id === "string") this.id = params.id
        this.position.x = params.position.x
        this.position.y = params.position.y
        this.type = params.type
        this.dead = false
        this.pool.game.events.emit("buffSpawn", { buff: this })
    }

    unset(){
        this.pool.game.events.emit("buffDespawn", { buff: this })
        this.dead = true
        this.position.x = 0
        this.position.y = 0
    }
}

export class BuffPool{
    game: PipPipGame

    buffs: Record<string, Buff> = {}

    constructor(game: PipPipGame){
        this.game = game
    }

    getAll(){
        return Object.values(this.buffs)
    }

    getActive(){
        return Object.values(this.buffs).filter(buff => buff.dead === false)
    }

    new(params: BuffParams){
        let output: Buff
        const reusable = this.getAll().find(buff => buff.dead === true)

        if(typeof reusable === "undefined"){
            const buff = new Buff(this)
            output = buff
        } else{
            output = reusable
            // A reused slot is re-keyed below to its (possibly networked) id, so
            // drop the stale key first to avoid leaving a dangling entry.
            delete this.buffs[output.id]
        }

        output.set(params)
        this.buffs[output.id] = output
        return output
    }

    unset(buff: Buff){
        if(!(buff.id in this.buffs)) return
        if(buff.dead === false){
            buff.unset()
        }
    }

    // Remove by id (used by the client when the server reports a pickup).
    unsetById(id: string){
        const buff = this.buffs[id]
        if(typeof buff !== "undefined") this.unset(buff)
    }

    destroy(){
        for(const id in this.buffs){
            const buff = this.buffs[id]
            this.unset(buff)
            delete this.buffs[id]
        }
    }
}
