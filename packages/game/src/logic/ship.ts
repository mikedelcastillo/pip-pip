import { RecursivePartial } from "@pip-pip/core/src/lib/types"
import { radianDifference } from "@pip-pip/core/src/math"
import { PointPhysicsObject } from "@pip-pip/core/src/physics"
import { PipPipGame } from "."
import { SHIP_DIAMETER } from "./constants"
import { MOVEMENT_CONFIG, MOVEMENT_ACCEL_RANGE, MOVEMENT_SPEED_RANGE } from "./physics-config"
import { PipPlayer } from "./player"
import { RAPIDFIRE_MULTIPLIER } from "./buff"
import { GLASS_CANNON_MAX_HEALTH, GLASS_CANNON_DAMAGE_MULTIPLIER, HEAVY_MAG_AMMO_MULTIPLIER } from "./buff-config"
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
        // Derived from the central MOVEMENT_CONFIG (physics-config.ts) so the
        // feel is tuned in one place. Override per ship below if a bird differs.
        acceleration: { ...MOVEMENT_ACCEL_RANGE },
        speed: { ...MOVEMENT_SPEED_RANGE },
        agility: MOVEMENT_CONFIG.agility,
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
    // Timed buffs from buffs. While > 0 the ship is hasted (faster
    // acceleration) / shielded (takes no damage) / invisible (cloaked, hard for
    // enemies to see) / ricochet (its bullets bounce off walls) / rapidfire (its
    // weapon-rate cooldown is shortened so it fires faster). `invisibility` is a
    // DISTINCT timer from the `invincibility` no-damage timer above - they are
    // unrelated. Set by applyBuffEffect, ticked down each tick in update().
    // haste/shield/invisibility/ricochet/rapidfire are all networked via
    // playerShipTimings so remote ships and the tactical feed see the windows.
    haste: number,
    shield: number,
    invisibility: number,
    ricochet: number,
    rapidfire: number,
    // More timed buffs. While > 0: glassCannon (deals triple damage but maxHealth
    // is forced to GLASS_CANNON_MAX_HEALTH), heavyMag (ammo capacity doubled),
    // regen (heals over time, applied server-side in updateBuffEffects), lifesteal
    // (damage dealt to enemies heals the dealer, applied in dealDamage). All ride
    // playerShipTimings like the buffs above and tick down each tick in update().
    glassCannon: number,
    heavyMag: number,
    regen: number,
    lifesteal: number,
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
        invisibility: 0,
        ricochet: 0,
        rapidfire: 0,
        glassCannon: 0,
        heavyMag: 0,
        regen: 0,
        lifesteal: 0,
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

        // Clear timed buffs on (re)spawn so a fresh ship starts un-hasted,
        // unshielded, un-cloaked, without ricochet and without rapidfire;
        // everything else respawns clean already.
        this.timings.haste = 0
        this.timings.shield = 0
        this.timings.invisibility = 0
        this.timings.ricochet = 0
        this.timings.rapidfire = 0
        this.timings.glassCannon = 0
        this.timings.heavyMag = 0
        this.timings.regen = 0
        this.timings.lifesteal = 0

        // Zero the weapon + tactical reload/rate timers so a respawned ship is
        // immediately fire-ready, matching its refilled ammo. update() ticks these
        // down every tick even while despawned, and the tactical reload (100 ticks)
        // outlasts the 60-tick respawn window, so without this a fresh ship shows
        // full tactical ammo yet canUseTactical reports it still reloading (no fire)
        // for up to ~2s. (invincibility / health-regen timers are left alone:
        // invincibility is intentional spawn protection.)
        this.timings.weaponReload = 0
        this.timings.weaponRate = 0
        this.timings.tacticalReload = 0
        this.timings.tacticalRate = 0
    }

    setPlayer(player: PipPlayer){
        this.player = player
    }

    setupPhysics(){
        this.physics.mass = MOVEMENT_CONFIG.mass
        this.physics.radius = SHIP_DIAMETER / 2
        this.physics.airResistance = MOVEMENT_CONFIG.friction
        // Ships collide with each other AND with walls. The client simulates
        // every ship, so it predicts the push too; the brief residual on
        // contact is absorbed by reconciliation.
        this.physics.collision.enabled = true
        this.physics.collision.channels = []
    }

    get maxHealth(){
        // Glass Cannon forces max health down to a fixed low value while active.
        // On expiry this reverts to the stat; current health is NOT topped up (it
        // simply stops being capped at the low value), per the buff design.
        if(this.timings.glassCannon > 0) return GLASS_CANNON_MAX_HEALTH
        return this.stats.health.capacity.normal
    }

    // Outgoing-damage multiplier applied in dealDamage to EVERY hit this ship
    // lands (bullets + grenade AoE). Glass Cannon triples it; otherwise 1.
    get damageMultiplier(){
        return this.timings.glassCannon > 0 ? GLASS_CANNON_DAMAGE_MULTIPLIER : 1
    }

    // Effective ammo capacities: Heavy Mag multiplies the stat capacity while
    // active (pickup refills to this, and weaponFull/tacticalFull + reload-refill
    // measure against it). Reverts to the stat on expiry, where update() clamps
    // any overflow ammo back down so a reload can't lose it.
    get weaponCapacity(){
        return this.stats.weapon.capacity * (this.timings.heavyMag > 0 ? HEAVY_MAG_AMMO_MULTIPLIER : 1)
    }

    get tacticalCapacity(){
        return this.stats.tactical.capacity * (this.timings.heavyMag > 0 ? HEAVY_MAG_AMMO_MULTIPLIER : 1)
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

    // Cloaked while the "invis" buff is running. Purely a visibility state — it
    // does NOT block damage (that is isShielded). The renderer fades the ship out
    // for enemies (and dims, but keeps, the local player's own ship) while true.
    get isInvisible(){
        return this.timings.invisibility > 0
    }

    // While the "ricochet" buff is running, this ship's bullets bounce off walls
    // instead of being destroyed on contact (up to a max bounce count). Read by
    // updateBulletPhysics against the bullet's OWNER so the buff travels with
    // every shot the player fires.
    get hasRicochet(){
        return this.timings.ricochet > 0
    }

    // While the "rapidfire" buff is running, this ship's weapon fires faster: the
    // per-shot weapon-rate cooldown is scaled by RAPIDFIRE_MULTIPLIER (see shoot).
    // Mirrors hasRicochet/isHasted - a gated boolean read off the buff timer.
    get hasRapidfire(){
        return this.timings.rapidfire > 0
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
        return this.capacities.weapon >= this.weaponCapacity
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
            // Rapidfire shortens the cooldown between shots: scale the weapon-rate
            // by RAPIDFIRE_MULTIPLIER (< 1) while the buff is up, the same gated-
            // multiplier shape haste uses on movement. ceil keeps it an integer
            // tick count and never drops it to 0 (so the trigger can't fire every
            // tick); normal firing is unchanged when the buff is inactive.
            const rapidfireFactor = this.hasRapidfire ? RAPIDFIRE_MULTIPLIER : 1
            this.timings.weaponRate = Math.ceil(this.stats.weapon.rate * rapidfireFactor)
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
        return this.capacities.tactical >= this.tacticalCapacity
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
        const wasHeavyMag = this.timings.heavyMag > 0

        this.timings.invincibility = tickDown(this.timings.invincibility)
        this.timings.healthRegenerationHeal = tickDown(this.timings.healthRegenerationHeal)
        this.timings.healthRegenerationRest = tickDown(this.timings.healthRegenerationRest)
        this.timings.weaponReload = tickDown(this.timings.weaponReload)
        this.timings.weaponRate = tickDown(this.timings.weaponRate)
        this.timings.tacticalReload = tickDown(this.timings.tacticalReload)
        this.timings.tacticalRate = tickDown(this.timings.tacticalRate)
        this.timings.haste = tickDown(this.timings.haste)
        this.timings.shield = tickDown(this.timings.shield)
        this.timings.invisibility = tickDown(this.timings.invisibility)
        this.timings.ricochet = tickDown(this.timings.ricochet)
        this.timings.rapidfire = tickDown(this.timings.rapidfire)
        this.timings.glassCannon = tickDown(this.timings.glassCannon)
        this.timings.heavyMag = tickDown(this.timings.heavyMag)
        this.timings.regen = tickDown(this.timings.regen)
        this.timings.lifesteal = tickDown(this.timings.lifesteal)

        // Heavy Mag just expired: the capacity getters now report the normal cap,
        // so clamp any overflow ammo down to it. Without this, an over-stocked mag
        // leaves weaponFull/tacticalFull false, which would let a reload fire and
        // REPLACE the overflow with the smaller normal capacity (losing ammo).
        if(wasHeavyMag && this.timings.heavyMag === 0){
            this.capacities.weapon = Math.min(this.capacities.weapon, this.weaponCapacity)
            this.capacities.tactical = Math.min(this.capacities.tactical, this.tacticalCapacity)
        }

        // take input from player
        if(typeof this.player !== "undefined"){
            // set angle
            this.targetRotation = this.player.inputs.aimRotation
        }

        // check if reload is done
        if(wasReloading && !this.isReloading){
            this.capacities.weapon = this.weaponCapacity
            if(typeof this.player !== "undefined"){
                this.game.events.emit("playerReloadEnd", { player: this.player })
            }
        }

        // check if the tactical reload is done
        if(wasTacticalReloading && !this.isTacticalReloading){
            this.capacities.tactical = this.tacticalCapacity
        }

        this.rotation += radianDifference(this.rotation, this.targetRotation) / (1 + 8 * (1 - this.stats.aim.accuracy))
    }
}

