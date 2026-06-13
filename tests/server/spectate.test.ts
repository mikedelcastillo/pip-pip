import { describe, expect, it } from "vitest"
import { PipPipGame } from "@pip-pip/game/src/logic"
import { processLobbyPackets } from "@pip-pip/server/src/connection-in"

// Build a fake lobby-events collector whose filter("packetMessage") returns one
// scripted playerSpectate packet from `connectionId`. processLobbyPackets only
// reads game + lobbyEvents.filter(...), so a minimal stub exercises the real
// spectate dispatch without standing up a websocket Connection. Mirrors the
// stub in bot-commands.test.ts.
function stubContext(game: PipPipGame, connectionId: string, packet: { playerId: string, spectating: boolean }){
    const events = [
        {
            packetMessage: {
                connection: { id: connectionId },
                packets: { playerSpectate: [packet] },
            },
        },
    ]
    const lobbyEvents = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        filter: (name: string) => (name === "packetMessage" ? events : []) as any,
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { game, lobbyEvents } as any
}

describe("server playerSpectate handling via processLobbyPackets", () => {
    it("sets a player's own spectator flag", () => {
        const game = new PipPipGame({ triggerSpawns: true })
        const player = game.createPlayer("AA")
        expect(player.spectator).toBe(false)

        processLobbyPackets(stubContext(game, "AA", { playerId: "AA", spectating: true }))

        expect(player.spectator).toBe(true)
    })

    it("despawns the player when it toggles to spectator mid-match", () => {
        const game = new PipPipGame({ triggerSpawns: true })
        const player = game.createPlayer("AA")
        game.startMatch()
        expect(player.spawned).toBe(true)

        processLobbyPackets(stubContext(game, "AA", { playerId: "AA", spectating: true }))

        expect(player.spectator).toBe(true)
        expect(player.spawned).toBe(false)
    })

    it("ignores a spectate packet that targets a player other than the sender", () => {
        const game = new PipPipGame({ triggerSpawns: true })
        const sender = game.createPlayer("AA")
        const other = game.createPlayer("BB")

        // AA tries to make BB a spectator — must be ignored (only own player).
        processLobbyPackets(stubContext(game, "AA", { playerId: "BB", spectating: true }))

        expect(other.spectator).toBe(false)
        expect(sender.spectator).toBe(false)
    })
})
