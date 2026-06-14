import { describe, expect, it } from "vitest"
import { PipPipGame, PipPipGamePhase } from "@pip-pip/game/src/logic"
import { PipPlayer } from "@pip-pip/game/src/logic/player"

// The server constructs the game with the authoritative spawn flag, so use it
// here to exercise the real addPlayerMidGame -> spawn / spectate paths.
function makeMatchGame(){
    return new PipPipGame({ triggerSpawns: true })
}

describe("mid-game join loadout gating", () => {
    it("parks a REAL player joining a live match as a spectator (no auto-spawn)", () => {
        const game = makeMatchGame()
        game.setPhase(PipPipGamePhase.MATCH)

        // Mirror the server join flow: createPlayer then addPlayerMidGame.
        const player = game.createPlayer("AA")
        game.addPlayerMidGame(player)

        // The player is NOT dropped into combat - they wait on the loadout
        // screen as a spectator until they Deploy.
        expect(player.spectator).toBe(true)
        expect(player.spawned).toBe(false)

        // Ticking the match does not sneak them in either (the respawn loop
        // skips spectators).
        for(let i = 0; i < 5; i++) game.update()
        expect(player.spawned).toBe(false)
    })

    it("spawns a BOT joining a live match immediately (training targets stay)", () => {
        const game = makeMatchGame()
        game.setPhase(PipPipGamePhase.MATCH)

        // addBot routes through addPlayerMidGame; a bot must spawn at once.
        const bot = game.addBot()

        expect(bot.isBot).toBe(true)
        expect(bot.spectator).toBe(false)
        expect(bot.spawned).toBe(true)
    })

    it("Deploy (un-spectate) then a tick spawns the parked joiner", () => {
        const game = makeMatchGame()
        game.setPhase(PipPipGamePhase.MATCH)

        const player = game.createPlayer("AA")
        game.addPlayerMidGame(player)
        expect(player.spectator).toBe(true)
        expect(player.spawned).toBe(false)

        // Deploy: the client clears the spectator flag (playerSpectate(false));
        // a fresh joiner has spawnTimeout 0, so the respawn loop spawns them on
        // the next tick.
        player.setSpectator(false)
        expect(player.timings.spawnTimeout).toBe(0)
        game.update()

        expect(player.spawned).toBe(true)
    })

    it("Spectate (stay parked) keeps the joiner out of combat across ticks", () => {
        const game = makeMatchGame()
        game.setPhase(PipPipGamePhase.MATCH)

        const player = game.createPlayer("AA")
        game.addPlayerMidGame(player)

        // Choosing Spectate is purely a client overlay dismissal - the player
        // stays the spectator the server parked them as, and never spawns.
        for(let i = 0; i < 20; i++) game.update()
        expect(player.spectator).toBe(true)
        expect(player.spawned).toBe(false)
    })

    it("does nothing in SETUP (no spectator parking before a match)", () => {
        const game = makeMatchGame()
        // Phase is SETUP by default; addPlayerMidGame is a no-op there.
        const player = game.createPlayer("AA")
        game.addPlayerMidGame(player)

        expect(player.spectator).toBe(false)
        expect(player.spawned).toBe(false)
    })
})
