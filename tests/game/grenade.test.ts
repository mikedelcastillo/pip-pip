import { describe, expect, it } from "vitest"
import { Vector2 } from "@pip-pip/core/src/physics"
import { PipPipGame, PipPipGamePhase } from "@pip-pip/game/src/logic"
import { PipPlayer } from "@pip-pip/game/src/logic/player"

// Ship index 3 ("Blu") uses pure default stats: ship radius 32, default tactical
// is the heavy "cannon" round (damage 40). Ship index 5 ("Djibouti") is the
// grenadier: its tactical fires "grenade" bullets (explosionRadius 220,
// damage 60).
const BLU = 3
const DJIBOUTI = 5

// Build an empty, very large arena so bullets fly unobstructed and nothing is
// clamped by walls or map bounds. Mirrors the helper in weapons.test.ts.
function makeArena(){
    const game = new PipPipGame({
        shootPlayerBullets: true,
        triggerDamage: true,
    })
    for(const seg of game.map.segWalls) game.physics.removeSegWall(seg)
    for(const rect of game.map.rectWalls) game.physics.removeRectWall(rect)
    game.map.bounds.min.x = -1000000
    game.map.bounds.min.y = -1000000
    game.map.bounds.max.x = 1000000
    game.map.bounds.max.y = 1000000
    game.setPhase(PipPipGamePhase.MATCH)
    return game
}

describe("grenade area-of-effect damage", () => {
    it("damages BOTH players inside the blast and spares a player outside it", () => {
        const game = makeArena()
        const owner = new PipPlayer(game, "OWN")
        const near1 = new PipPlayer(game, "N1")
        const near2 = new PipPlayer(game, "N2")
        const far = new PipPlayer(game, "FAR")
        owner.setShip(BLU)
        near1.setShip(BLU)
        near2.setShip(BLU)
        far.setShip(BLU)

        // Keep the owner well clear of the blast so only near1/near2 are caught.
        game.spawnPlayer(owner, 100000, 100000)
        // Two players bracketing the detonation point (0,0), both inside a
        // 200-unit blast (centre distance 40, reach = 200 + 32).
        game.spawnPlayer(near1, -40, 0)
        game.spawnPlayer(near2, 40, 0)
        // One player far outside the blast.
        game.spawnPlayer(far, 5000, 0)

        const dealt: Record<string, number> = {}
        game.events.on("dealDamage", ({ target, damage }) => {
            dealt[target.id] = (dealt[target.id] ?? 0) + damage
        })

        // Drop a grenade at the origin and let its lifespan expire so it
        // detonates. Velocity 0 keeps it parked at (0,0).
        game.bullets.new({
            position: new Vector2(0, 0),
            velocity: new Vector2(0, 0),
            owner,
            speed: 0,
            radius: 16,
            rotation: 0,
            damage: 60,
            type: "grenade",
            explosionRadius: 200,
        })

        for(let i = 0; i < 200; i++) game.update()

        expect(dealt["N1"] ?? 0).toBeGreaterThan(0)
        expect(dealt["N2"] ?? 0).toBeGreaterThan(0)
        expect(dealt["FAR"] ?? 0).toBe(0)
    })

    it("applies linear distance falloff: a player at the edge takes less than one at the centre", () => {
        const game = makeArena()
        const owner = new PipPlayer(game, "OWN")
        const center = new PipPlayer(game, "CTR")
        const edge = new PipPlayer(game, "EDG")
        owner.setShip(BLU)
        center.setShip(BLU)
        edge.setShip(BLU)

        game.spawnPlayer(owner, 100000, 100000)
        // Detonation at (0,0): one player dead-centre, one near the blast edge.
        game.spawnPlayer(center, 0, 0)
        game.spawnPlayer(edge, 190, 0)

        const dealt: Record<string, number> = {}
        game.events.on("dealDamage", ({ target, damage }) => {
            dealt[target.id] = (dealt[target.id] ?? 0) + damage
        })

        game.bullets.new({
            position: new Vector2(0, 0),
            velocity: new Vector2(0, 0),
            owner,
            speed: 0,
            radius: 16,
            rotation: 0,
            damage: 60,
            type: "grenade",
            explosionRadius: 200,
        })

        for(let i = 0; i < 200; i++) game.update()

        expect(dealt["CTR"] ?? 0).toBeGreaterThan(0)
        expect(dealt["EDG"] ?? 0).toBeGreaterThan(0)
        expect(dealt["EDG"]).toBeLessThan(dealt["CTR"])
    })

    it("includes the grenade's own owner in the blast (self-damage)", () => {
        const game = makeArena()
        const owner = new PipPlayer(game, "OWN")
        owner.setShip(BLU)
        game.spawnPlayer(owner, 0, 0)

        let ownerDealt = 0
        game.events.on("dealDamage", ({ target, damage }) => {
            if(target.id === "OWN") ownerDealt += damage
        })

        // Owner standing on their own grenade as it expires.
        game.bullets.new({
            position: new Vector2(0, 0),
            velocity: new Vector2(0, 0),
            owner,
            speed: 0,
            radius: 16,
            rotation: 0,
            damage: 60,
            type: "grenade",
            explosionRadius: 200,
        })

        for(let i = 0; i < 200; i++) game.update()
        expect(ownerDealt).toBeGreaterThan(0)
    })
})

describe("grenade tactical weapon configuration", () => {
    it("a grenade-tactical ship fires a bullet of type \"grenade\" carrying its blast radius", () => {
        const game = makeArena()
        const shooter = new PipPlayer(game, "GR")
        shooter.setShip(DJIBOUTI)
        game.spawnPlayer(shooter, 0, 0)
        shooter.inputs.aimRotation = 0

        const fired: { type: string, explosionRadius: number }[] = []
        game.events.on("addBullet", ({ bullet }) => {
            fired.push({ type: bullet.type, explosionRadius: bullet.explosionRadius })
        })

        shooter.inputs.useTactical = true
        for(let i = 0; i < 12; i++) game.update()

        expect(fired.length).toBeGreaterThan(0)
        expect(fired[0].type).toBe("grenade")
        expect(fired[0].explosionRadius).toBe(220)
    })

    it("a normal ship's tactical still fires a \"tactical\" cannon round (no grenade)", () => {
        const game = makeArena()
        const shooter = new PipPlayer(game, "BL")
        shooter.setShip(BLU)
        game.spawnPlayer(shooter, 0, 0)
        shooter.inputs.aimRotation = 0

        const types: string[] = []
        game.events.on("addBullet", ({ bullet }) => types.push(bullet.type))

        shooter.inputs.useTactical = true
        for(let i = 0; i < 12; i++) game.update()

        expect(types.length).toBeGreaterThan(0)
        expect(types).toContain("tactical")
        expect(types).not.toContain("grenade")
    })
})
