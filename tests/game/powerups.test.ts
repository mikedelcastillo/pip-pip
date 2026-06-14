import { describe, expect, it } from "vitest"
import { PipPipGame, PipPipGamePhase } from "@pip-pip/game/src/logic"
import { PipPlayer } from "@pip-pip/game/src/logic/player"
import { Vector2 } from "@pip-pip/core/src/physics"
import { HASTE_TICKS, SHIELD_TICKS, INVIS_TICKS, applyPowerupEffect } from "@pip-pip/game/src/logic/powerup"

// Ship index 3 ("Blu") uses pure default stats, so its numbers are predictable.
const BLU = 3

// Build a clean arena with no walls and huge bounds (so nothing is clamped),
// powerup spawning + damage enabled, phase set to MATCH, one spawned player.
function makeArena(options = {}){
    const game = new PipPipGame({
        shootPlayerBullets: true,
        triggerDamage: true,
        spawnPowerups: true,
        ...options,
    })

    for(const seg of game.map.segWalls) game.physics.removeSegWall(seg)
    for(const rect of game.map.rectWalls) game.physics.removeRectWall(rect)
    game.map.bounds.min.x = -100000
    game.map.bounds.min.y = -100000
    game.map.bounds.max.x = 100000
    game.map.bounds.max.y = 100000

    const player = new PipPlayer(game, "AA")
    player.setShip(BLU)

    game.setPhase(PipPipGamePhase.MATCH)
    game.spawnPlayer(player, 0, 0)

    return { game, player }
}

describe("map powerups", () => {
    it("heals a spawned player that overlaps a health powerup, capped at max", () => {
        const { game, player } = makeArena()
        // Damage the ship so a heal has room to act.
        player.ship.capacities.health = 10
        const before = player.ship.capacities.health

        const powerup = game.powerups.new({
            position: new Vector2(player.ship.physics.position.x, player.ship.physics.position.y),
            type: "health",
        })

        game.update()

        expect(powerup.dead).toBe(true)
        expect(game.powerups.getActive()).toHaveLength(0)
        expect(player.ship.capacities.health).toBeGreaterThan(before)
        expect(player.ship.capacities.health).toBeLessThanOrEqual(player.ship.maxHealth)
    })

    it("does not exceed max health when healing a nearly-full ship", () => {
        const { game, player } = makeArena()
        player.ship.capacities.health = player.ship.maxHealth - 1

        game.powerups.new({
            position: new Vector2(player.ship.physics.position.x, player.ship.physics.position.y),
            type: "health",
        })

        game.update()

        expect(player.ship.capacities.health).toBe(player.ship.maxHealth)
    })

    it("refills weapon and tactical capacity on an ammo powerup", () => {
        const { game, player } = makeArena()
        player.ship.capacities.weapon = 0
        player.ship.capacities.tactical = 0

        const powerup = game.powerups.new({
            position: new Vector2(player.ship.physics.position.x, player.ship.physics.position.y),
            type: "ammo",
        })

        game.update()

        expect(powerup.dead).toBe(true)
        expect(player.ship.capacities.weapon).toBe(player.ship.stats.weapon.capacity)
        expect(player.ship.capacities.tactical).toBe(player.ship.stats.tactical.capacity)
    })

    it("emits a powerupPickup event naming the player and powerup", () => {
        const { game, player } = makeArena()
        player.ship.capacities.health = 10
        const picks: Array<{ playerId: string, powerupId: string }> = []
        game.events.on("powerupPickup", ({ player, powerup }) => {
            picks.push({ playerId: player.id, powerupId: powerup.id })
        })

        const powerup = game.powerups.new({
            position: new Vector2(0, 0),
            type: "health",
        })
        game.update()

        expect(picks).toEqual([{ playerId: player.id, powerupId: powerup.id }])
    })

    it("does not pick up a powerup the player does not overlap", () => {
        const { game, player } = makeArena()
        player.ship.capacities.health = 10

        game.powerups.new({
            position: new Vector2(5000, 5000),
            type: "health",
        })
        game.update()

        expect(game.powerups.getActive()).toHaveLength(1)
        expect(player.ship.capacities.health).toBe(10)
    })

    it("does not pick up a powerup when the player is despawned", () => {
        const { game, player } = makeArena()
        player.ship.capacities.health = 10
        player.setSpawned(false)

        game.powerups.new({
            position: new Vector2(player.ship.physics.position.x, player.ship.physics.position.y),
            type: "health",
        })
        game.update()

        expect(game.powerups.getActive()).toHaveLength(1)
        expect(player.ship.capacities.health).toBe(10)
    })

    it("hastes a player that overlaps a haste powerup", () => {
        const { game, player } = makeArena()
        expect(player.ship.timings.haste).toBe(0)

        game.powerups.new({
            position: new Vector2(player.ship.physics.position.x, player.ship.physics.position.y),
            type: "haste",
        })

        game.update()

        expect(player.ship.timings.haste).toBeGreaterThan(0)
    })

    it("a hasted player accelerates faster than an un-hasted one over N ticks", () => {
        // Two identical arenas, identical drive input; one player is hasted.
        const N = 15
        const drive = { angle: 0, amount: 1 }

        function runFor(hasted: boolean){
            const { game, player } = makeArena()
            player.ship.physics.position.x = 0
            player.ship.physics.position.y = 0
            player.ship.physics.velocity.x = 0
            player.ship.physics.velocity.y = 0
            player.inputs.movementAngle = drive.angle
            player.inputs.movementAmount = drive.amount
            player.inputs.aimRotation = drive.angle
            if(hasted) player.ship.timings.haste = 1000 // stay hasted the whole run
            for(let i = 0; i < N; i++) game.update()
            return player.ship.physics.position.x
        }

        const plain = runFor(false)
        const fast = runFor(true)
        expect(fast).toBeGreaterThan(plain)
    })

    it("shields a player that overlaps a shield powerup", () => {
        const { game, player } = makeArena()
        expect(player.ship.timings.shield).toBe(0)

        game.powerups.new({
            position: new Vector2(player.ship.physics.position.x, player.ship.physics.position.y),
            type: "shield",
        })

        game.update()

        expect(player.ship.timings.shield).toBeGreaterThan(0)
    })

    it("a shielded player takes ZERO damage from a bullet, then normal damage after it expires", () => {
        const { game, player } = makeArena()
        const owner = new PipPlayer(game, "BB")
        owner.setShip(BLU)

        player.ship.timings.shield = 5
        const fullHealth = player.ship.capacities.health

        // Fire a bullet dead-centre on the shielded target.
        game.bullets.new({
            position: new Vector2(player.ship.physics.position.x, player.ship.physics.position.y),
            owner,
            velocity: new Vector2(0, 0),
            speed: 0,
            radius: 4,
            rotation: 0,
            damage: 4,
            type: "primary",
        })
        game.update()
        expect(player.ship.capacities.health).toBe(fullHealth)

        // Let the shield expire, then a fresh bullet must deal normal damage.
        player.ship.timings.shield = 0
        game.bullets.new({
            position: new Vector2(player.ship.physics.position.x, player.ship.physics.position.y),
            owner,
            velocity: new Vector2(0, 0),
            speed: 0,
            radius: 4,
            rotation: 0,
            damage: 4,
            type: "primary",
        })
        game.update()
        expect(player.ship.capacities.health).toBeLessThan(fullHealth)
    })

    it("a shielded player takes ZERO damage from a grenade detonation", () => {
        const { game, player } = makeArena()
        const owner = new PipPlayer(game, "BB")
        owner.setShip(BLU)

        player.ship.timings.shield = 5
        const fullHealth = player.ship.capacities.health

        // Grenade dead-centre on the shielded target detonates on contact.
        game.bullets.new({
            position: new Vector2(player.ship.physics.position.x, player.ship.physics.position.y),
            owner,
            velocity: new Vector2(0, 0),
            speed: 0,
            radius: 14,
            rotation: 0,
            damage: 40,
            type: "grenade",
            explosionRadius: 120,
        })
        game.update()
        expect(player.ship.capacities.health).toBe(fullHealth)
    })

    it("buff timings tick down to 0 over their duration", () => {
        const { game, player } = makeArena()
        // Set both buffs directly: a single pickup loop only picks up one
        // overlapping powerup per tick, so seed the timings to test tick-down.
        player.ship.timings.haste = HASTE_TICKS
        player.ship.timings.shield = SHIELD_TICKS

        const haste = player.ship.timings.haste
        const shield = player.ship.timings.shield
        expect(haste).toBeGreaterThan(0)
        expect(shield).toBeGreaterThan(0)

        // Drive enough ticks to outlast the longer of the two buffs.
        for(let i = 0; i < Math.max(haste, shield) + 5; i++) game.update()
        expect(player.ship.timings.haste).toBe(0)
        expect(player.ship.timings.shield).toBe(0)
    })

    it("spawns powerups during MATCH when spawnPowerups is enabled", () => {
        const { game } = makeArena()
        // Drive enough ticks to cross several spawn intervals.
        for(let i = 0; i < game.POWERUP_SPAWN_INTERVAL_TICKS * 5; i++) game.update()
        const active = game.powerups.getActive().length
        expect(active).toBeGreaterThan(0)
        expect(active).toBeLessThanOrEqual(game.POWERUP_MAX_ACTIVE)
    })

    it("never spawns more than the active cap", () => {
        const { game } = makeArena()
        for(let i = 0; i < game.POWERUP_SPAWN_INTERVAL_TICKS * 20; i++) game.update()
        expect(game.powerups.getActive().length).toBeLessThanOrEqual(game.POWERUP_MAX_ACTIVE)
    })

    it("does not spawn powerups when spawnPowerups is disabled", () => {
        const { game } = makeArena({ spawnPowerups: false })
        for(let i = 0; i < game.POWERUP_SPAWN_INTERVAL_TICKS * 5; i++) game.update()
        expect(game.powerups.getActive()).toHaveLength(0)
    })

    it("does not spawn powerups outside the MATCH phase", () => {
        const { game } = makeArena()
        game.setPhase(PipPipGamePhase.SETUP)
        for(let i = 0; i < game.POWERUP_SPAWN_INTERVAL_TICKS * 5; i++) game.update()
        expect(game.powerups.getActive()).toHaveLength(0)
    })

    it("cloaks a player that overlaps an invis powerup", () => {
        const { game, player } = makeArena()
        expect(player.ship.timings.invisibility).toBe(0)
        expect(player.ship.isInvisible).toBe(false)

        game.powerups.new({
            position: new Vector2(player.ship.physics.position.x, player.ship.physics.position.y),
            type: "invis",
        })

        game.update()

        expect(player.ship.timings.invisibility).toBeGreaterThan(0)
        expect(player.ship.isInvisible).toBe(true)
    })
})

describe("invisibility (cloak) buff", () => {
    it("applyPowerupEffect sets the invisibility timer to INVIS_TICKS", () => {
        const { player } = makeArena()
        expect(player.ship.timings.invisibility).toBe(0)

        applyPowerupEffect("invis", player)

        expect(player.ship.timings.invisibility).toBe(INVIS_TICKS)
    })

    it("INVIS_TICKS fits in a uint8 so it survives the playerShipTimings wire", () => {
        expect(INVIS_TICKS).toBeLessThanOrEqual(255)
    })

    it("isInvisible reflects the invisibility timer", () => {
        const { player } = makeArena()
        expect(player.ship.isInvisible).toBe(false)

        player.ship.timings.invisibility = 1
        expect(player.ship.isInvisible).toBe(true)

        player.ship.timings.invisibility = 0
        expect(player.ship.isInvisible).toBe(false)
    })

    it("invisibility is DISTINCT from the invincibility no-damage timer", () => {
        const { player } = makeArena()

        // The cloak does not block damage (that is isShielded), and the legacy
        // invincibility timer does not cloak the ship.
        player.ship.timings.invisibility = INVIS_TICKS
        expect(player.ship.isInvisible).toBe(true)
        expect(player.ship.isShielded).toBe(false)

        player.ship.timings.invisibility = 0
        player.ship.timings.invincibility = 5
        expect(player.ship.isInvisible).toBe(false)
        expect(player.ship.isShielded).toBe(true)
    })

    it("the invisibility timer ticks down to 0 over its duration", () => {
        const { game, player } = makeArena()
        player.ship.timings.invisibility = INVIS_TICKS
        expect(player.ship.timings.invisibility).toBeGreaterThan(0)

        for(let i = 0; i < INVIS_TICKS + 5; i++) game.update()

        expect(player.ship.timings.invisibility).toBe(0)
        expect(player.ship.isInvisible).toBe(false)
    })

    it("reset() clears the invisibility timer", () => {
        const { player } = makeArena()
        player.ship.timings.invisibility = INVIS_TICKS

        player.ship.reset()

        expect(player.ship.timings.invisibility).toBe(0)
        expect(player.ship.isInvisible).toBe(false)
    })
})
