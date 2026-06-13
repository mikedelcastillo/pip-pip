import { describe, expect, it } from "vitest"
import { Vector2 } from "@pip-pip/core/src/physics"
import { PipPipGame, PipPipGamePhase } from "@pip-pip/game/src/logic"
import { PipPlayer } from "@pip-pip/game/src/logic/player"
import { INTERP_DELAY_TICKS } from "@pip-pip/game/src/logic/constants"

// Ship index 3 ("Blu") uses pure default stats: ship radius 32, primary bullet
// radius 4 / velocity 100 / damage 4, default defense ratio 1.
const BLU = 3

// Build an empty, very large arena so bullets fly unobstructed and nothing is
// clamped by walls or map bounds.
function makeArena(opts: Partial<{ considerPlayerPing: boolean }> = {}){
    const game = new PipPipGame({
        shootPlayerBullets: true,
        triggerDamage: true,
        ...opts,
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

describe("bullet-vs-player damage resolution", () => {
    // Regression: a bullet that already overlaps its target but shares the
    // target's velocity has zero relative motion (tDenominator === 0). The old
    // swept test skipped that case outright and solved only for the circle's
    // EXIT root, so a bullet sitting inside a target dealt no damage. A start of
    // tick overlap must always count as a hit.
    it("a bullet overlapping a target it shares velocity with still deals damage", () => {
        const game = makeArena()
        const owner = new PipPlayer(game, "OWNER")
        const target = new PipPlayer(game, "TGT")
        owner.setShip(BLU)
        target.setShip(BLU)
        // Owner is only the bullet's owner; keep it out of the world.
        game.spawnPlayer(target, 0, 0)
        target.ship.physics.velocity.x = 80

        let dealt = 0
        game.events.on("dealDamage", ({ damage }) => { dealt += damage })

        // Bullet dead-centre on the target, moving at the SAME velocity (relative
        // speed 0).
        game.bullets.new({
            position: new Vector2(0, 0),
            owner,
            velocity: new Vector2(80, 0),
            speed: 80,
            radius: 4,
            rotation: 0,
            damage: 4,
            type: "primary",
        })

        for(let i = 0; i < 5; i++) game.update()
        expect(dealt).toBeGreaterThan(0)
    })

    // Regression: the swept-circle test must register the FIRST contact (entry),
    // not the exit root. Sweep a stationary target across a range of spawn and
    // transverse offsets; every shot whose straight path actually passes through
    // the combined-radius circle must deal damage.
    it("every primary shot whose path crosses a stationary target deals damage", () => {
        const r = 32 + 4
        const misses: string[] = []
        for(let along = -50; along <= 50; along += 2){
            for(let trans = 0; trans <= 40; trans += 1){
                const game = makeArena()
                const owner = new PipPlayer(game, "OWNER")
                const target = new PipPlayer(game, "TGT")
                owner.setShip(BLU)
                target.setShip(BLU)
                game.spawnPlayer(target, 0, 0)

                let dealt = 0
                game.events.on("dealDamage", ({ damage }) => { dealt += damage })
                game.bullets.new({
                    position: new Vector2(along, trans),
                    owner,
                    velocity: new Vector2(100, 0),
                    speed: 100,
                    radius: 4,
                    rotation: 0,
                    damage: 4,
                    type: "primary",
                })

                // Continuous oracle: does the path pass within r of the target?
                const px = along, py = trans
                const a = 100 * 100
                const b = 2 * px * 100
                const c = px * px + py * py - r * r
                const disc = b * b - 4 * a * c
                const pathHits = disc >= 0
                    && (-b + Math.sqrt(disc)) / (2 * a) >= 0
                    && (-b - Math.sqrt(disc)) / (2 * a) <= 200

                for(let i = 0; i < 12; i++) game.update()
                if(pathHits && dealt === 0) misses.push(`along=${along},trans=${trans}`)
            }
        }
        expect(misses).toEqual([])
    })
})

describe("lag-compensated hit detection (considerPlayerPing)", () => {
    // Regression: lag compensation rewinds the target to where the shooter saw
    // it WHEN FIRING. The rewind must stay anchored to that fired-at moment for
    // the bullet's whole flight. Previously the lookback was measured from the
    // ever-advancing "now", so the rewound hitbox slid forward each tick and a
    // bullet aimed where the shooter saw a MOVING target could never catch it —
    // dealing zero damage at every ping.
    function fireAtSeenPosition(ping: number){
        const game = makeArena({ considerPlayerPing: true })
        const owner = new PipPlayer(game, "OWNER")
        const target = new PipPlayer(game, "TGT")
        owner.setShip(BLU)
        target.setShip(BLU)
        owner.ping = ping
        target.ping = ping
        game.spawnPlayer(target, 300, 0)

        // Target drives steadily in +y; warm up so the rewind history is full.
        target.inputs.movementAngle = Math.PI / 2
        target.inputs.movementAmount = 1
        for(let i = 0; i < 12; i++) game.update()

        // Where the shooter SEES the target right now (same lookback the server
        // collision uses): ping/2 ticks + render interpolation delay.
        const lookback = (ping / 2) / game.deltaMs + INTERP_DELAY_TICKS
        const seen = target.getLastTickState(lookback)

        // Fire a bullet from the origin straight at that seen position. A correct
        // lag-comp implementation must score a hit.
        const dist = Math.hypot(seen.positionX, seen.positionY)
        const speed = 100
        let dealt = 0
        game.events.on("dealDamage", ({ damage }) => { dealt += damage })
        game.bullets.new({
            position: new Vector2(0, 0),
            owner,
            velocity: new Vector2((seen.positionX / dist) * speed, (seen.positionY / dist) * speed),
            speed,
            radius: 4,
            rotation: 0,
            damage: 4,
            type: "primary",
        })

        for(let i = 0; i < 20; i++) game.update()
        return dealt
    }

    it("a bullet aimed where the shooter saw a moving target connects at every ping", () => {
        for(const ping of [0, 60, 100, 200, 300]){
            expect(fireAtSeenPosition(ping), `ping=${ping}`).toBeGreaterThan(0)
        }
    })
})
