import { describe, expect, it } from "vitest"
import { Vector2 } from "@pip-pip/core/src/physics"
import { PipPipGame, PipPipGamePhase } from "@pip-pip/game/src/logic"
import { PipPlayer } from "@pip-pip/game/src/logic/player"

// Spectator mode: a spectator never spawns. The server constructs the game
// with triggerSpawns, so use that flag here to exercise the real spawn path.
function makeGame(){
    return new PipPipGame({ triggerSpawns: true })
}

describe("spectator spawn gating", () => {
    it("does not spawn a spectator at match start, while non-spectators spawn", () => {
        const game = makeGame()
        const player = new PipPlayer(game, "AA")
        const spectator = new PipPlayer(game, "BB")
        spectator.setSpectator(true)

        game.startMatch()

        expect(player.spawned).toBe(true)
        expect(spectator.spawned).toBe(false)
    })

    it("despawns a player immediately when it becomes a spectator", () => {
        const game = makeGame()
        const player = new PipPlayer(game, "AA")
        game.startMatch()
        expect(player.spawned).toBe(true)

        player.setSpectator(true)

        expect(player.spectator).toBe(true)
        expect(player.spawned).toBe(false)
        expect(player.canSpawn).toBe(false)
    })

    it("canSpawn reports false for a spectator and a re-spawn attempt is a no-op", () => {
        const game = makeGame()
        const spectator = new PipPlayer(game, "AA")
        spectator.setSpectator(true)

        expect(spectator.canSpawn).toBe(false)
        // spawnPlayer without explicit coordinates must respect canSpawn.
        game.spawnPlayer(spectator)
        expect(spectator.spawned).toBe(false)
    })

    it("a spectator never spawned is not a bullet target (collision loop skips unspawned)", () => {
        // Build a damage-enabled arena and confirm a spectator (never spawned)
        // takes no damage even with a bullet sitting on its ship's origin.
        const game = new PipPipGame({ triggerSpawns: true, triggerDamage: true, shootPlayerBullets: true })
        const owner = new PipPlayer(game, "AA")
        const spectator = new PipPlayer(game, "BB")
        spectator.setSpectator(true)
        game.startMatch()
        game.setPhase(PipPipGamePhase.MATCH)

        let dealt = 0
        game.events.on("dealDamage", ({ target, damage }) => {
            if(target === spectator) dealt += damage
        })

        // Bullet right where the spectator's ship object sits.
        game.bullets.new({
            position: new Vector2(
                spectator.ship.physics.position.x,
                spectator.ship.physics.position.y,
            ),
            owner,
            speed: 0,
            radius: 100,
            rotation: 0,
            damage: 10,
            type: "primary",
        })

        for(let i = 0; i < 5; i++) game.update()
        expect(dealt).toBe(0)
        expect(spectator.spawned).toBe(false)
    })

    it("toggling spectator off restores the ability to spawn", () => {
        const game = makeGame()
        const player = new PipPlayer(game, "AA")
        player.setSpectator(true)
        player.setSpectator(false)

        expect(player.spectator).toBe(false)
        expect(player.canSpawn).toBe(true)
    })
})
