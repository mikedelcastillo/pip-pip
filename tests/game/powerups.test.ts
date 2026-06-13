import { describe, expect, it } from "vitest"
import { PipPipGame, PipPipGamePhase } from "@pip-pip/game/src/logic"
import { PipPlayer } from "@pip-pip/game/src/logic/player"
import { Vector2 } from "@pip-pip/core/src/physics"

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
})
