import { describe, expect, it } from "vitest"
import { PipPipGame, PipPipGamePhase } from "@pip-pip/game/src/logic"
import { PipPlayer } from "@pip-pip/game/src/logic/player"
import { PointPhysicsSegmentWall, Vector2 } from "@pip-pip/core/src/physics"
import { applyPowerupEffect, RICOCHET_TICKS } from "@pip-pip/game/src/logic/powerup"
import { MAX_BULLET_BOUNCES } from "@pip-pip/game/src/logic/bullet"

// Ship index 3 ("Blu") uses pure default stats, so its numbers are predictable.
const BLU = 3

// Build a clean arena with NO walls and huge bounds, damage + powerups enabled,
// phase MATCH, one spawned player who OWNS the bullets we fire. A single
// horizontal wall is added by the tests that need one (so other tests stay in an
// empty arena). The owning player is what carries the ricochet buff.
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
    // Park the owner far from the bullet path so it never picks the shot up as a
    // pickup or collides with it.
    game.spawnPlayer(player, 50000, 50000)

    return { game, player }
}

// A long horizontal wall along y = 0 (radius 25, the segment default). A bullet
// travelling in +y crosses it; reflecting flips the y velocity to -y.
function addHorizontalWall(game: PipPipGame){
    const wall = new PointPhysicsSegmentWall("wall", -5000, 0, 5000, 0)
    game.physics.addSegWall(wall)
    return wall
}

describe("ricochet powerup", () => {
    it("applyPowerupEffect sets the ricochet timer to RICOCHET_TICKS", () => {
        const { player } = makeArena()
        expect(player.ship.timings.ricochet).toBe(0)

        applyPowerupEffect("ricochet", player)

        expect(player.ship.timings.ricochet).toBe(RICOCHET_TICKS)
        expect(player.ship.hasRicochet).toBe(true)
    })

    it("RICOCHET_TICKS fits in the uint16 playerShipTimings wire field", () => {
        expect(RICOCHET_TICKS).toBeLessThanOrEqual(65535)
    })

    it("the ricochet timer ticks down to 0 over its duration", () => {
        const { game, player } = makeArena()
        player.ship.timings.ricochet = RICOCHET_TICKS
        expect(player.ship.timings.ricochet).toBeGreaterThan(0)

        for(let i = 0; i < RICOCHET_TICKS + 5; i++) game.update()

        expect(player.ship.timings.ricochet).toBe(0)
        expect(player.ship.hasRicochet).toBe(false)
    })

    it("reset() clears the ricochet timer", () => {
        const { player } = makeArena()
        player.ship.timings.ricochet = RICOCHET_TICKS

        player.ship.reset()

        expect(player.ship.timings.ricochet).toBe(0)
        expect(player.ship.hasRicochet).toBe(false)
    })

    it("hastes-style spawn: picks up a ricochet powerup it overlaps", () => {
        const { game, player } = makeArena()
        // Move the owner onto a powerup so the pickup loop applies it.
        player.ship.physics.position.x = 0
        player.ship.physics.position.y = 0
        player.trackPositionState()
        expect(player.ship.timings.ricochet).toBe(0)

        game.powerups.new({
            position: new Vector2(0, 0),
            type: "ricochet",
        })
        game.update()

        expect(player.ship.timings.ricochet).toBeGreaterThan(0)
    })

    it("a ricochet bullet REFLECTS off a wall and SURVIVES", () => {
        const { game, player } = makeArena()
        addHorizontalWall(game)
        player.ship.timings.ricochet = RICOCHET_TICKS

        // Fire just above the wall, travelling straight down into it. The swept
        // segment (position -> position + velocity) crosses y = 0 this tick.
        const bullet = game.bullets.new({
            position: new Vector2(0, -30),
            owner: player,
            velocity: new Vector2(0, 100),
            speed: 100,
            radius: 4,
            rotation: Math.PI / 2,
            damage: 4,
            type: "primary",
        })

        game.update()

        // The bullet is still alive and its downward velocity has flipped to up:
        // it bounced off the horizontal wall instead of being destroyed.
        expect(bullet.dead).toBe(false)
        expect(bullet.physics.velocity.y).toBeLessThan(0)
        expect(bullet.bounces).toBe(1)
    })

    it("a ricochet bullet stops bouncing after MAX_BULLET_BOUNCES and is then destroyed", () => {
        const { game, player } = makeArena()
        addHorizontalWall(game)
        player.ship.timings.ricochet = RICOCHET_TICKS

        const bullet = game.bullets.new({
            position: new Vector2(0, -30),
            owner: player,
            velocity: new Vector2(0, 100),
            speed: 100,
            radius: 4,
            rotation: Math.PI / 2,
            damage: 4,
            type: "primary",
        })

        // Force the bullet to the cap, then re-aim it back into the wall so the
        // next wall contact has no bounces left and must destroy it. Re-seed the
        // position/velocity so it re-hits the same wall this tick.
        bullet.bounces = MAX_BULLET_BOUNCES
        bullet.physics.position.x = 0
        bullet.physics.position.y = -30
        bullet.physics.velocity.x = 0
        bullet.physics.velocity.y = 100

        game.update()

        // A capped bullet does NOT bounce again: it is destroyed like a normal
        // bullet (unset clears bounces back to 0, so assert via destruction).
        expect(bullet.dead).toBe(true)
        expect(game.bullets.getActive()).toHaveLength(0)
    })

    it("bounces increment up to the cap over repeated wall hits", () => {
        const { game, player } = makeArena()
        addHorizontalWall(game)
        player.ship.timings.ricochet = RICOCHET_TICKS

        const bullet = game.bullets.new({
            position: new Vector2(0, -30),
            owner: player,
            velocity: new Vector2(0, 100),
            speed: 100,
            radius: 4,
            rotation: Math.PI / 2,
            damage: 4,
            type: "primary",
        })

        // Drive the bullet back into the wall each tick so it bounces repeatedly.
        // It must never exceed the cap and must survive every capped bounce.
        for(let i = 0; i < MAX_BULLET_BOUNCES + 2; i++){
            bullet.physics.position.x = 0
            bullet.physics.position.y = -30
            bullet.physics.velocity.x = 0
            bullet.physics.velocity.y = 100
            if(bullet.bounces >= MAX_BULLET_BOUNCES) break
            game.update()
        }

        expect(bullet.bounces).toBe(MAX_BULLET_BOUNCES)
        expect(bullet.dead).toBe(false)
    })

    it("a NORMAL (non-ricochet) bullet is still DESTROYED on a wall hit", () => {
        const { game, player } = makeArena()
        addHorizontalWall(game)
        // No ricochet buff on the owner.
        expect(player.ship.hasRicochet).toBe(false)

        const bullet = game.bullets.new({
            position: new Vector2(0, -30),
            owner: player,
            velocity: new Vector2(0, 100),
            speed: 100,
            radius: 4,
            rotation: Math.PI / 2,
            damage: 4,
            type: "primary",
        })

        game.update()

        expect(bullet.dead).toBe(true)
        expect(game.bullets.getActive()).toHaveLength(0)
    })

    it("a GRENADE never ricochets even with the buff: it detonates on wall contact", () => {
        const { game, player } = makeArena()
        addHorizontalWall(game)
        player.ship.timings.ricochet = RICOCHET_TICKS

        const grenade = game.bullets.new({
            position: new Vector2(0, -30),
            owner: player,
            velocity: new Vector2(0, 100),
            speed: 100,
            radius: 14,
            rotation: Math.PI / 2,
            damage: 40,
            type: "grenade",
            explosionRadius: 120,
        })

        game.update()

        // The grenade is gone (detonated on contact), not bounced.
        expect(grenade.dead).toBe(true)
        expect(grenade.bounces).toBe(0)
        expect(game.bullets.getActive()).toHaveLength(0)
    })
})
