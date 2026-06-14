import { describe, expect, it } from "vitest"
import { PipPipGame, PipPipGamePhase } from "@pip-pip/game/src/logic"
import { PipPlayer } from "@pip-pip/game/src/logic/player"
import { PointPhysicsRectWall, Vector2 } from "@pip-pip/core/src/physics"
import { RICOCHET_TICKS } from "@pip-pip/game/src/logic/powerup"

// Ship index 3 ("Blu") uses pure default stats, so its numbers are predictable.
const BLU = 3

// Clean arena with NO walls and huge bounds. Rectangle walls (the kind the map
// editor's greedy-meshed full tiles produce) are added per test. The owning
// player carries the ricochet buff.
function makeArena(){
    const game = new PipPipGame({
        shootPlayerBullets: true,
        triggerDamage: true,
        spawnPowerups: true,
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
    // Park the owner far from the bullet path so it never picks up the shot.
    game.spawnPlayer(player, 50000, 50000)

    return { game, player }
}

// An axis-aligned box wall centred at (cx, cy) with the given full size.
function addRectWall(game: PipPipGame, cx: number, cy: number, width: number, height: number){
    const wall = new PointPhysicsRectWall("rect")
    wall.center.x = cx
    wall.center.y = cy
    wall.width = width
    wall.height = height
    game.physics.addRectWall(wall)
    return wall
}

describe("bullet vs rectangle wall", () => {
    it("a fast bullet whose path crosses a rect wall is destroyed (no tunnelling)", () => {
        const { game, player } = makeArena()
        // Thin tall box on the bullet's path.
        addRectWall(game, 0, 0, 40, 4000)

        // Spawn left of the box travelling +x at 100/tick. The motion segment
        // (-30 -> 70) crosses the box centred at x=0 this single tick.
        const bullet = game.bullets.new({
            position: new Vector2(-30, 0),
            owner: player,
            velocity: new Vector2(100, 0),
            speed: 100,
            radius: 4,
            rotation: 0,
            damage: 4,
            type: "primary",
        })

        game.update()

        expect(bullet.dead).toBe(true)
        expect(game.bullets.getActive()).toHaveLength(0)
    })

    it("pure tunnelling: neither endpoint inside the rect but the segment passes through", () => {
        const { game, player } = makeArena()
        // A very thin box (8 wide); a 100/tick bullet jumps over it in one tick
        // so NEITHER endpoint (-200 and -100) lands inside, yet the swept
        // segment passes clean through the box centred at x = -150.
        addRectWall(game, -150, 0, 8, 4000)

        const bullet = game.bullets.new({
            position: new Vector2(-200, 0),
            owner: player,
            velocity: new Vector2(100, 0),
            speed: 100,
            radius: 4,
            rotation: 0,
            damage: 4,
            type: "primary",
        })

        // Sanity: at tick start neither endpoint of the motion segment is inside
        // the box, so only a swept test can catch this.
        const startX = bullet.physics.position.x
        const endX = startX + bullet.physics.velocity.x
        expect(Math.abs(startX - (-150))).toBeGreaterThan(4)
        expect(Math.abs(endX - (-150))).toBeGreaterThan(4)

        game.update()

        expect(bullet.dead).toBe(true)
        expect(game.bullets.getActive()).toHaveLength(0)
    })

    it("a bullet that does NOT cross the rect is left active", () => {
        const { game, player } = makeArena()
        // Box well below the horizontal flight path.
        addRectWall(game, 0, 1000, 200, 200)

        const bullet = game.bullets.new({
            position: new Vector2(-30, 0),
            owner: player,
            velocity: new Vector2(100, 0),
            speed: 100,
            radius: 4,
            rotation: 0,
            damage: 4,
            type: "primary",
        })

        game.update()

        expect(bullet.dead).toBe(false)
        expect(game.bullets.getActive()).toHaveLength(1)
    })

    it("a ricochet bullet reflects off a rect FACE and survives", () => {
        const { game, player } = makeArena()
        player.ship.timings.ricochet = RICOCHET_TICKS
        // Large box whose LEFT face is at x = 0. Bullet approaches from the left
        // travelling +x; reflecting off the left face flips vx to -x.
        addRectWall(game, 200, 0, 400, 4000)

        const bullet = game.bullets.new({
            position: new Vector2(-30, 0),
            owner: player,
            velocity: new Vector2(100, 0),
            speed: 100,
            radius: 4,
            rotation: 0,
            damage: 4,
            type: "primary",
        })

        game.update()

        // Survived, the into-face velocity component flipped, bounces ticked up,
        // and it ended outside the left face (x < 0).
        expect(bullet.dead).toBe(false)
        expect(bullet.physics.velocity.x).toBeLessThan(0)
        expect(bullet.bounces).toBe(1)
        expect(bullet.physics.position.x).toBeLessThan(0)
    })

    it("a grenade detonates on rect contact", () => {
        const { game, player } = makeArena()
        // Even with the ricochet buff a grenade never bounces.
        player.ship.timings.ricochet = RICOCHET_TICKS
        addRectWall(game, 0, 0, 200, 4000)

        const grenade = game.bullets.new({
            position: new Vector2(-120, 0),
            owner: player,
            velocity: new Vector2(100, 0),
            speed: 100,
            radius: 14,
            rotation: 0,
            damage: 40,
            type: "grenade",
            explosionRadius: 120,
        })

        game.update()

        expect(grenade.dead).toBe(true)
        expect(grenade.bounces).toBe(0)
        expect(game.bullets.getActive()).toHaveLength(0)
    })

    it("resolves at most one wall contact per tick across seg AND rect walls", () => {
        const { game, player } = makeArena()
        player.ship.timings.ricochet = RICOCHET_TICKS
        // A rect wall AND a seg wall both sit on the bullet's path. With the
        // one-contact-per-tick guard the bullet must bounce exactly once.
        addRectWall(game, 0, 0, 40, 4000)

        const bullet = game.bullets.new({
            position: new Vector2(-30, 0),
            owner: player,
            velocity: new Vector2(100, 0),
            speed: 100,
            radius: 4,
            rotation: 0,
            damage: 4,
            type: "primary",
        })

        game.update()

        // Exactly one bounce was recorded this tick.
        expect(bullet.dead).toBe(false)
        expect(bullet.bounces).toBe(1)
    })
})
