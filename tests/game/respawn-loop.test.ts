import { describe, expect, it } from "vitest"
import { PipPipGame, PipPipGamePhase } from "@pip-pip/game/src/logic"
import { PipPlayer } from "@pip-pip/game/src/logic/player"

const BLU = 3

function makeServerGame(){
    return new PipPipGame({
        triggerSpawns: true,
        triggerDamage: true,
        triggerPhases: true,
        setScores: true,
        shootPlayerBullets: true,
    })
}

describe("respawn robustness", () => {
    it("a lone player stays spawned through a match start (no respawn loop)", () => {
        const game = makeServerGame()
        const p = new PipPlayer(game, "AA")
        p.setShip(BLU)
        game.startMatch()
        for(let i = 0; i < 300; i++) game.update()
        expect(game.phase).toBe(PipPipGamePhase.MATCH)
        expect(p.spawned).toBe(true)
    })

    it("startMatch clears a leftover respawn timer so the player spawns at once", () => {
        const game = makeServerGame()
        const p = new PipPlayer(game, "AA")
        p.setShip(BLU)
        // Simulate a player who was dead when the match was (re)started.
        p.timings.spawnTimeout = 60
        game.startMatch()
        // The fix resets the timer and spawns them during the countdown, instead
        // of leaving them dead/respawning at the start.
        expect(p.spawned).toBe(true)
        expect(p.timings.spawnTimeout).toBe(0)
    })

    it("respawns a player stranded despawned with no timer (the infinite-respawn bug)", () => {
        const game = makeServerGame()
        const p = new PipPlayer(game, "AA")
        p.setShip(BLU)
        game.spawnPlayer(p, 0, 0)
        game.setPhase(PipPipGamePhase.MATCH)
        // Strand the player: despawned, spawnTimeout 0. The OLD code never
        // respawned this (wasWaitingForSpawn required spawnTimeout !== 0), so the
        // client showed "Respawning" forever.
        p.setSpawned(false)
        p.timings.spawnTimeout = 0
        game.update()
        expect(p.spawned).toBe(true)
    })

    it("still honours the death timer (no instant respawn)", () => {
        const game = makeServerGame()
        const p = new PipPlayer(game, "AA")
        p.setShip(BLU)
        game.spawnPlayer(p, 0, 0)
        game.setPhase(PipPipGamePhase.MATCH)
        // Simulate a death: despawn with the standard 3s (60 tick) timer.
        p.setSpawned(false)
        p.timings.spawnTimeout = 60
        for(let i = 0; i < 59; i++) game.update()
        expect(p.spawned).toBe(false) // still dead during the countdown
        game.update() // 60th tick: timer hits 0 -> respawn
        expect(p.spawned).toBe(true)
    })
})
