import { beforeEach, describe, expect, it } from "vitest"
import { PipPipGame, PipPipGamePhase } from "@pip-pip/game/src/logic"
import { PipPlayer } from "@pip-pip/game/src/logic/player"

// Ship index 3 ("Blu") uses pure default stats, so its numbers are predictable:
// primary bullet damage = 4, tactical damage = 40, default defense ratio = 1.
const BLU = 3

// Build a clean two-player arena with no walls so bullets fly unobstructed and
// nothing is clamped by map bounds. Both players use the default-stats ship.
function makeArena(){
    const game = new PipPipGame({
        shootPlayerBullets: true,
        triggerDamage: true,
    })

    // Strip the loaded map down to an empty, very large arena.
    for(const seg of game.map.segWalls) game.physics.removeSegWall(seg)
    for(const rect of game.map.rectWalls) game.physics.removeRectWall(rect)
    game.map.bounds.min.x = -100000
    game.map.bounds.min.y = -100000
    game.map.bounds.max.x = 100000
    game.map.bounds.max.y = 100000

    const shooter = new PipPlayer(game, "AA")
    const target = new PipPlayer(game, "BB")
    shooter.setShip(BLU)
    target.setShip(BLU)

    game.setPhase(PipPipGamePhase.MATCH)
    game.spawnPlayer(shooter, 0, 0)
    game.spawnPlayer(target, 200, 0)
    // Aim straight along +x toward the target.
    shooter.inputs.aimRotation = 0

    return { game, shooter, target }
}

describe("PipShip tactical weapon mechanics", () => {
    let game: PipPipGame
    let shooter: PipPlayer

    beforeEach(() => {
        ({ game, shooter } = makeArena())
    })

    it("starts with full tactical ammo and can fire", () => {
        const ship = shooter.ship
        expect(ship.capacities.tactical).toBe(ship.stats.tactical.capacity)
        expect(ship.canUseTactical).toBe(true)
    })

    it("consumes one round per shot and enforces the rate cooldown", () => {
        const ship = shooter.ship
        const start = ship.capacities.tactical

        expect(ship.shootTactical()).toBe(true)
        expect(ship.capacities.tactical).toBe(start - 1)
        // Rate cooldown is now active, so an immediate second shot is blocked.
        expect(ship.canUseTactical).toBe(false)
        expect(ship.shootTactical()).toBe(false)
        expect(ship.capacities.tactical).toBe(start - 1)
    })

    it("triggers a reload when emptied and refills after the reload window", () => {
        const ship = shooter.ship
        // Empty the magazine, clearing the rate cooldown between shots.
        while(ship.capacities.tactical > 0){
            ship.timings.tacticalRate = 0
            expect(ship.shootTactical()).toBe(true)
        }
        expect(ship.tacticalEmpty).toBe(true)

        // A shot on empty starts the reload instead of firing.
        ship.timings.tacticalRate = 0
        expect(ship.shootTactical()).toBe(false)
        expect(ship.isTacticalReloading).toBe(true)

        // Tick the ship until the reload finishes; ammo should refill.
        for(let i = 0; i <= ship.stats.tactical.reload.ticks; i++) ship.update()
        expect(ship.isTacticalReloading).toBe(false)
        expect(ship.capacities.tactical).toBe(ship.stats.tactical.capacity)
    })
})

describe("weapon damage in the server simulation", () => {
    it("tactical fire deals the heavy tactical damage to a target", () => {
        const { game, shooter, target } = makeArena()
        const damages: number[] = []
        const bulletTypes: string[] = []
        game.events.on("dealDamage", ({ damage }) => damages.push(damage))
        game.events.on("addBullet", ({ bullet }) => bulletTypes.push(bullet.type))

        shooter.inputs.useTactical = true
        for(let i = 0; i < 12; i++) game.update()

        expect(bulletTypes).toContain("tactical")
        expect(damages.length).toBeGreaterThan(0)
        // tactical damage 40 * default defense ratio (1) = 40
        expect(damages[0]).toBe(40)
        expect(target.ship.capacities.health).toBe(target.ship.maxHealth - 40)
    })

    it("primary fire deals the light primary damage to a target", () => {
        const { game, shooter, target } = makeArena()
        const damages: number[] = []
        const bulletTypes: string[] = []
        game.events.on("dealDamage", ({ damage }) => damages.push(damage))
        game.events.on("addBullet", ({ bullet }) => bulletTypes.push(bullet.type))

        shooter.inputs.useWeapon = true
        for(let i = 0; i < 12; i++) game.update()

        expect(bulletTypes).toContain("primary")
        expect(damages.length).toBeGreaterThan(0)
        // primary damage 4 * default defense ratio (1) = 4
        expect(damages[0]).toBe(4)
    })

    it("does not fire when the player is not spawned", () => {
        const { game, shooter, target } = makeArena()
        target.setSpawned(false)
        shooter.setSpawned(false)
        const bullets: number[] = []
        game.events.on("addBullet", () => bullets.push(1))

        shooter.inputs.useTactical = true
        shooter.inputs.useWeapon = true
        for(let i = 0; i < 12; i++) game.update()

        expect(bullets.length).toBe(0)
    })
})
