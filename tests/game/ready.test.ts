import { describe, expect, it } from "vitest"
import { PipPipGame } from "@pip-pip/game/src/logic"
import { PipPlayer } from "@pip-pip/game/src/logic/player"

// The lobby "ready up" flag lives on PipPlayer with a setReady() that emits
// playerReadyChange (mirroring setTeam / playerTeamChange), and startMatch clears
// every player's ready so each fresh round starts unready. These pin that
// behaviour - the wire + UI sit on top of it.

describe("PipPlayer ready up", () => {
    it("defaults to not ready", () => {
        const game = new PipPipGame()
        const player = new PipPlayer(game, "AA")
        expect(player.ready).toBe(false)
    })

    it("setReady toggles the flag and emits playerReadyChange", () => {
        const game = new PipPipGame()
        const player = new PipPlayer(game, "AA")

        let events = 0
        let lastPlayer: PipPlayer | undefined
        game.events.on("playerReadyChange", ({ player: p }) => {
            events += 1
            lastPlayer = p
        })

        player.setReady(true)
        expect(player.ready).toBe(true)
        expect(events).toBe(1)
        expect(lastPlayer).toBe(player)

        player.setReady(false)
        expect(player.ready).toBe(false)
        expect(events).toBe(2)
    })

    it("setReady is a no-op (no event) when the value is unchanged", () => {
        const game = new PipPipGame()
        const player = new PipPlayer(game, "AA")

        let events = 0
        game.events.on("playerReadyChange", () => { events += 1 })

        // Already false: no change, no event.
        player.setReady(false)
        expect(events).toBe(0)

        player.setReady(true)
        expect(events).toBe(1)
        // Setting the same value again does nothing.
        player.setReady(true)
        expect(events).toBe(1)
    })

    it("startMatch clears ready for all players", () => {
        // startMatch clears ready on the authoritative side (gated on
        // triggerSpawns), so each fresh lobby round starts unready.
        const game = new PipPipGame({ triggerSpawns: true })
        const a = new PipPlayer(game, "AA")
        const b = new PipPlayer(game, "BB")
        const c = new PipPlayer(game, "CC")

        a.setReady(true)
        b.setReady(true)
        c.setReady(true)
        expect(a.ready && b.ready && c.ready).toBe(true)

        game.startMatch()

        expect(a.ready).toBe(false)
        expect(b.ready).toBe(false)
        expect(c.ready).toBe(false)
    })
})
