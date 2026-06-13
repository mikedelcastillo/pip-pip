import { describe, expect, it } from "vitest"
import { PipPipGame, PipPipGamePhase } from "@pip-pip/game/src/logic"
import { PipPlayer } from "@pip-pip/game/src/logic/player"
import { Bullet } from "@pip-pip/game/src/logic/bullet"
import { createShipStats, createRange } from "@pip-pip/game/src/logic/ship"

// Ship index 3 ("Blu") uses pure default stats: single straight shot.
const BLU = 3
// Ship index 4 ("Flora") is the 5-pellet scatter gun.
const FLORA = 4

// Build a clean two-player arena with no walls so bullets fly unobstructed and
// nothing is clamped by map bounds.
function makeArena(shooterShip = BLU, targetShip = BLU){
    const game = new PipPipGame({
        shootPlayerBullets: true,
        triggerDamage: true,
    })

    for(const seg of game.map.segWalls) game.physics.removeSegWall(seg)
    for(const rect of game.map.rectWalls) game.physics.removeRectWall(rect)
    game.map.bounds.min.x = -100000
    game.map.bounds.min.y = -100000
    game.map.bounds.max.x = 100000
    game.map.bounds.max.y = 100000

    const shooter = new PipPlayer(game, "AA")
    const target = new PipPlayer(game, "BB")
    shooter.setShip(shooterShip)
    target.setShip(targetShip)

    game.setPhase(PipPipGamePhase.MATCH)
    game.spawnPlayer(shooter, 0, 0)
    game.spawnPlayer(target, 200, 0)
    shooter.inputs.aimRotation = 0

    return { game, shooter, target }
}

// The direction a bullet is travelling, in radians.
function bulletAngle(bullet: Bullet){
    return Math.atan2(bullet.physics.velocity.y, bullet.physics.velocity.x)
}

describe("primary spray patterns", () => {
    it("default-stats ship fires exactly one straight bullet per shot", () => {
        const { game, shooter } = makeArena()
        const fired: Bullet[] = []
        game.events.on("addBullet", ({ bullet }) => fired.push(bullet))

        // Single shot: enable the weapon for one tick only so the rate cooldown
        // prevents a follow-up shot.
        shooter.inputs.useWeapon = true
        game.update()

        expect(fired.length).toBe(1)
        expect(bulletAngle(fired[0])).toBeCloseTo(0, 6)
    })

    it("a spread weapon fires count bullets at symmetric angle offsets", () => {
        // Build an explicit 5-pellet, 0.45 rad cone so the expected offsets are
        // independent of any ship's balance numbers.
        const COUNT = 5
        const ANGLE = 0.45

        const { game, shooter } = makeArena()
        shooter.ship.stats = createShipStats({
            weapon: {
                spread: { count: COUNT, angle: ANGLE },
            },
        })

        const fired: Bullet[] = []
        game.events.on("addBullet", ({ bullet }) => fired.push(bullet))

        shooter.inputs.useWeapon = true
        game.update()

        expect(fired.length).toBe(COUNT)

        const angles = fired.map(bulletAngle).sort((a, b) => a - b)
        // Expected fan: -A/2 + i * (A / (N - 1)), centred on 0.
        for(let i = 0; i < COUNT; i++){
            const expected = -ANGLE / 2 + i * (ANGLE / (COUNT - 1))
            expect(angles[i]).toBeCloseTo(expected, 6)
        }
        // Symmetric about the aim direction (0).
        expect(angles[0]).toBeCloseTo(-ANGLE / 2, 6)
        expect(angles[COUNT - 1]).toBeCloseTo(ANGLE / 2, 6)
    })

    it("a count-2 twin shot fires two bullets at +/- half the cone", () => {
        const ANGLE = 0.05
        const { game, shooter } = makeArena()
        shooter.ship.stats = createShipStats({
            weapon: {
                spread: { count: 2, angle: ANGLE },
            },
        })

        const fired: Bullet[] = []
        game.events.on("addBullet", ({ bullet }) => fired.push(bullet))

        shooter.inputs.useWeapon = true
        game.update()

        expect(fired.length).toBe(2)
        const angles = fired.map(bulletAngle).sort((a, b) => a - b)
        expect(angles[0]).toBeCloseTo(-ANGLE / 2, 6)
        expect(angles[1]).toBeCloseTo(ANGLE / 2, 6)
    })

    it("Flora fires its configured 5-pellet scatter", () => {
        const { game, shooter } = makeArena(FLORA)
        const fired: Bullet[] = []
        game.events.on("addBullet", ({ bullet }) => fired.push(bullet))

        shooter.inputs.useWeapon = true
        game.update()

        expect(shooter.ship.stats.weapon.spread.count).toBe(5)
        expect(fired.length).toBe(shooter.ship.stats.weapon.spread.count)
    })
})

describe("spread damage", () => {
    it("a spread pellet still damages a target sitting in the cone", () => {
        // A straight-ahead spread: the target at +x is dead-centre, so at least
        // the centre-ish pellets connect.
        const { game, shooter, target } = makeArena()
        shooter.ship.stats = createShipStats({
            weapon: {
                spread: { count: 5, angle: 0.2 },
            },
            bullet: {
                damage: createRange(20),
            },
        })

        const damages: number[] = []
        game.events.on("dealDamage", ({ damage }) => damages.push(damage))

        shooter.inputs.useWeapon = true
        for(let i = 0; i < 30; i++) game.update()

        expect(damages.length).toBeGreaterThan(0)
        expect(target.ship.capacities.health).toBeLessThan(target.ship.maxHealth)
    })

    it("scales per-pellet damage down by the pellet count", () => {
        // configured bullet damage 20, count 5 -> each pellet deals 4
        // (4 * default defense ratio 1 = 4).
        const { game, shooter, target } = makeArena()
        shooter.ship.stats = createShipStats({
            weapon: {
                // Single dead-centre pellet so exactly one hit registers and the
                // per-pellet damage is unambiguous.
                spread: { count: 5, angle: 0 },
            },
            bullet: {
                damage: createRange(20),
            },
        })

        const damages: number[] = []
        game.events.on("dealDamage", ({ damage }) => damages.push(damage))

        // Fire a single shot, then stop firing so only that one shot's pellets
        // are in flight, and tick until they reach the target at +x.
        shooter.inputs.useWeapon = true
        game.update()
        shooter.inputs.useWeapon = false
        for(let i = 0; i < 30; i++) game.update()

        // All 5 pellets travel straight (angle 0) and overlap, so each deals the
        // scaled-down per-pellet damage of 20 / 5 = 4.
        expect(damages.length).toBeGreaterThan(0)
        expect(damages[0]).toBe(4)
    })
})
