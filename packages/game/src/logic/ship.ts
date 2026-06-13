import { RecursivePartial } from "@pip-pip/core/src/lib/types"
import { radianDifference } from "@pip-pip/core/src/math"
import { PointPhysicsObject } from "@pip-pip/core/src/physics"
import { PipPipGame } from "."
import { SHIP_DAIMETER } from "./constants"
import { PipPlayer } from "./player"
import { tickDown } from "./utils"

export type StatRange = {
    low: number,
    normal: number,
    high: number,
}

// Spray pattern for a weapon. `count` is the number of bullets emitted per
// shot (>= 1); `angle` is the TOTAL cone width in radians the pellets are fanned
// across (0 = no spread, single straight shot). A count of 1 always fires
// straight regardless of angle.
export type SpreadStat = {
    count: number,
    angle: number,
}

export type ShipStats = {
    aim: {
        speed: number,
        accuracy: number,
    },
    movement: {
        acceleration: StatRange,
        speed: StatRange,
        agility: number,
    },
    weapon: {
        capacity: number,
        rate: number,
        spread: SpreadStat,
        reload: {
            ticks: number,
        },
    },
    tactical: {
        capacity: number,
        rate: number,
        spread: SpreadStat,
        damage: StatRange,
        reload: {
            ticks: number,
        },
        bullet: {
            velocity: number,
            radius: number,
        },
        // What the tactical weapon fires. "cannon" (default) is the existing
        // heavy single-target round (spawned as a "tactical" bullet). "grenade"
        // spawns a "grenade" bullet that detonates with area-of-effect damage
        // when it ends its life; explosionRadius is its blast radius in world
        // units (ignored for "cannon").
        bulletKind: "cannon" | "grenade",
        explosionRadius: number,
    },
    bullet: {
        velocity: number,
        radius: number,
        damage: StatRange,
    },
    defense: StatRange,
    health: {
        capacity: StatRange,
        regeneration: {
            amount: StatRange,
            ticks: {
                rest: number,
                heal: number,
            },
        },
    },
}

export function createRange(normal: number, effect = 0.2): StatRange{
    return {
        low: normal * (1 - effect),
        normal,
        high: normal * (1 + effect),
    }
}

export const DEFAULT_SHIP_STATS: ShipStats = {
    aim: {
        speed: 0.8,
        accuracy: 0.75,
    },
    movement: {
        acceleration: {
            low: 3,
            normal: 4,
            high: 6,
        },
        speed: {
            low: 25,
            normal: 30,
            high: 35,
        },
        agility: 0.6,
    },
    weapon: {
        capacity: 20,
        rate: 3,
        spread: {
            count: 1,
            angle: 0,
        },
        reload: {
            ticks: 20,
        },
    },
    tactical: {
        capacity: 3,
        rate: 20,
        spread: {
            count: 1,
            angle: 0,
        },
        damage: createRange(40),
        reload: {
            ticks: 20 * 5,
        },
        bullet: {
            velocity: 60,
            radius: 14,
        },
        bulletKind: "cannon",
        explosionRadius: 0,
    },
    bullet: {
        velocity: 100,
        radius:  4,
        damage: createRange(4),
    },
    defense: createRange(1),
    health: {
        capacity: createRange(100),
        regeneration: {
            amount: createRange(10),
            ticks: {
                rest: 20 * 5,
                heal: 5,
            },
        },
    },
}

export const createShipStats = (stats: RecursivePartial<ShipStats> = {}): ShipStats => {
    const output = {} as ShipStats

    type T = Record<string, unknown>
    type K = T | undefined

    function applyChanges(
        target: T, 
        changes: K, 
        source: T){
        for(const key in source){
            if(typeof source[key] === "object"){
                target[key] = {}
                applyChanges(target[key] as T, changes?.[key] as K, source[key] as T)
            } else{
                if(typeof changes === "undefined"){
                    target[key] = source[key]
                } else{
                    if(typeof changes[key] === "undefined"){
                        target[key] = source[key]
                    } else{
                        target[key] = changes[key]
                    }
                }
            }
        }
    }
    
    applyChanges(output, stats, DEFAULT_SHIP_STATS)

    return output
}

export type ShipTimings = {
    weaponReload: number,
    weaponRate: number,
    tacticalReload: number,
    tacticalRate: number,
    healthRegenerationRest: number,
    healthRegenerationHeal: number,
    invincibility: number,
    // Timed buffs from powerups. While > 0 the ship is hasted (faster
    // acceleration) / shielded (takes no damage). Set by applyPowerupEffect,
    // ticked down each tick in update(), networked via playerShipTimings.
    haste: number,
    shield: number,
}

export type ShipCapacities = {
    weapon: number,
    tactical: number,
    health: number,
}

export class PipShip{
    static shipType = "ship"
    static shipName = "Ship"
    static shipTextureId = "ship"

    id: string

    physics = new PointPhysicsObject()

    player?: PipPlayer // allow for AI to control
    game: PipPipGame

    rotation = 0
    targetRotation = 0

    stats = DEFAULT_SHIP_STATS

    timings: ShipTimings = {
        invincibility: 0,

        healthRegenerationHeal: 0,
        healthRegenerationRest: 0,

        weaponReload: 0,
        weaponRate: 0,

        tacticalReload: 0,
        tacticalRate: 0,

        haste: 0,
        shield: 0,
    }

    capacities: ShipCapacities = {
        health: 0,
        tactical: 0,
        weapon: 0,
    }

    constructor(game: PipPipGame, id: string){
        this.id = id
        this.game = game

        this.reset()
        this.setupPhysics()
    }

    reset(){
        this.capacities.health = this.stats.health.capacity.normal
        this.capacities.tactical = this.stats.tactical.capacity
        this.capacities.weapon = this.stats.weapon.capacity

        // Clear timed buffs on (re)spawn so a fresh ship starts un-hasted and
        // unshielded; everything else respawns clean already.
        this.timings.haste = 0
        this.timings.shield = 0
    }

    setPlayer(player: PipPlayer){
        this.player = player
    }

    setupPhysics(){
        this.physics.mass = 500
        this.physics.radius = SHIP_DAIMETER / 2
        this.physics.airResistance = 0.05
        // Ships collide with each other AND with walls. The client simulates
        // every ship, so it predicts the push too; the brief residual on
        // contact is absorbed by reconciliation.
        this.physics.collision.enabled = true
        this.physics.collision.channels = []
    }

    get maxHealth(){
        return this.stats.health.capacity.normal
    }

    get defense(){
        const def = this.stats.defense.normal
        return Math.max(0, Math.min(2, def))
    }

    get isDead(){
        if(this.capacities.health === 0) return true
        return false
    }

    // Fully damage-immune this tick: either a "shield" buff is active, or the
    // legacy invincibility timer is running (folded in here so it finally gates
    // something). Server-authoritative damage (dealDamage / detonateGrenade)
    // checks this and deals zero to a shielded target.
    get isShielded(){
        return this.timings.shield > 0 || this.timings.invincibility > 0
    }

    get isReloading(){
        if(this.timings.weaponReload !== 0) return true
        return false
    }

    get canReload(){
        if(this.isReloading) return false
        if(this.weaponFull) return false
        return true
    }

    get weaponEmpty(){
        return this.capacities.weapon === 0
    }

    get weaponFull(){
        return this.capacities.weapon === this.stats.weapon.capacity
    }

    get canUseWeapon(){
        if(this.isReloading === true) return false
        if(this.weaponEmpty === true) return false
        if(this.timings.weaponRate !== 0) return false
        return true
    }

    shoot(){
        if(this.canUseWeapon){
            this.capacities.weapon = tickDown(this.capacities.weapon, 1)
            this.timings.weaponRate = this.stats.weapon.rate
            return true
        } else if(this.weaponEmpty){
            this.reload()
        }
        return false
    }

    reload(){
        if(this.canReload){
            this.timings.weaponReload = this.stats.weapon.reload.ticks
            if(typeof this.player !== "undefined"){
                this.game.events.emit("playerReloadStart", { player: this.player })
            }
        }
    }

    get isTacticalReloading(){
        return this.timings.tacticalReload !== 0
    }

    get tacticalEmpty(){
        return this.capacities.tactical === 0
    }

    get tacticalFull(){
        return this.capacities.tactical === this.stats.tactical.capacity
    }

    get canReloadTactical(){
        if(this.isTacticalReloading) return false
        if(this.tacticalFull) return false
        return true
    }

    get canUseTactical(){
        if(this.isTacticalReloading === true) return false
        if(this.tacticalEmpty === true) return false
        if(this.timings.tacticalRate !== 0) return false
        return true
    }

    // The secondary weapon: a slow, heavy, high-damage cannon. Mirrors the
    // primary weapon's ammo/rate/reload model but on its own timings so the
    // two fire independently.
    shootTactical(){
        if(this.canUseTactical){
            this.capacities.tactical = tickDown(this.capacities.tactical, 1)
            this.timings.tacticalRate = this.stats.tactical.rate
            return true
        } else if(this.tacticalEmpty){
            this.reloadTactical()
        }
        return false
    }

    reloadTactical(){
        if(this.canReloadTactical){
            this.timings.tacticalReload = this.stats.tactical.reload.ticks
        }
    }

    update(){
        const wasReloading = this.isReloading
        const wasTacticalReloading = this.isTacticalReloading

        this.timings.invincibility = tickDown(this.timings.invincibility)
        this.timings.healthRegenerationHeal = tickDown(this.timings.healthRegenerationHeal)
        this.timings.healthRegenerationRest = tickDown(this.timings.healthRegenerationRest)
        this.timings.weaponReload = tickDown(this.timings.weaponReload)
        this.timings.weaponRate = tickDown(this.timings.weaponRate)
        this.timings.tacticalReload = tickDown(this.timings.tacticalReload)
        this.timings.tacticalRate = tickDown(this.timings.tacticalRate)
        this.timings.haste = tickDown(this.timings.haste)
        this.timings.shield = tickDown(this.timings.shield)

        // take input from player
        if(typeof this.player !== "undefined"){
            // set angle
            this.targetRotation = this.player.inputs.aimRotation
        }

        // check if reload is done
        if(wasReloading && !this.isReloading){
            this.capacities.weapon = this.stats.weapon.capacity
            if(typeof this.player !== "undefined"){
                this.game.events.emit("playerReloadEnd", { player: this.player })
            }
        }

        // check if the tactical reload is done
        if(wasTacticalReloading && !this.isTacticalReloading){
            this.capacities.tactical = this.stats.tactical.capacity
        }

        this.rotation += radianDifference(this.rotation, this.targetRotation) / (1 + 8 * (1 - this.stats.aim.accuracy))
    }
}

