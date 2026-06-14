import { describe, expect, it } from "vitest"
import { PipPipGame, PipPipGamePhase } from "@pip-pip/game/src/logic"
import { packetManager } from "@pip-pip/game/src/networking/packets"
import { processLobbyPackets } from "@pip-pip/server/src/connection-in"

// A recording stand-in for a core Connection: we only need an id and a send()
// that captures whatever bytes the close handler pushes to it.
function stubConnection(id: string){
    const sent: ArrayBuffer[] = []
    return {
        id,
        sent,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        send: (data: ArrayBuffer) => { sent.push(data) },
    }
}

// Mirrors the other server tests' stub style, but also supplies a `lobby` (with
// connections + a server.removeLobby spy) because the close handler tears the
// lobby down via the core API. The scripted packet is a closeLobby from
// `connectionId`; processLobbyPackets reads game + lobbyEvents + lobby only, so
// this drives the real host gating without a websocket Connection.
function stubContext(
    game: PipPipGame,
    connectionId: string,
    connections: ReturnType<typeof stubConnection>[],
){
    const events = [
        {
            packetMessage: {
                connection: { id: connectionId },
                packets: { closeLobby: [{}] },
            },
        },
    ]
    const lobbyEvents = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        filter: (name: string) => (name === "packetMessage" ? events : []) as any,
    }
    const removed: unknown[] = []
    const connectionMap: Record<string, ReturnType<typeof stubConnection>> = {}
    for(const connection of connections) connectionMap[connection.id] = connection
    const lobby = {
        connections: connectionMap,
        server: {
            removeLobby: (target: unknown) => { removed.push(target) },
        },
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { context: { game, lobbyEvents, lobby } as any, removed, lobby }
}

// Decode a captured buffer and report whether it carried a lobbyClosed packet.
function carriesLobbyClosed(buffer: ArrayBuffer){
    return (packetManager.decode(buffer).lobbyClosed || []).length > 0
}

describe("host-only closeLobby via processLobbyPackets", () => {
    it("notifies every connection and removes the lobby when the host closes", () => {
        const game = new PipPipGame()
        const host = game.createPlayer("AA")
        game.createPlayer("BB")
        game.setHost(host)

        const hostConn = stubConnection("AA")
        const otherConn = stubConnection("BB")
        const { context, removed, lobby } = stubContext(game, "AA", [hostConn, otherConn])

        processLobbyPackets(context)

        // Every connection in the lobby got exactly one lobbyClosed notice.
        expect(hostConn.sent).toHaveLength(1)
        expect(otherConn.sent).toHaveLength(1)
        expect(carriesLobbyClosed(hostConn.sent[0])).toBe(true)
        expect(carriesLobbyClosed(otherConn.sent[0])).toBe(true)

        // The lobby was disbanded via the core API (removeLobby called with it).
        expect(removed).toEqual([lobby])
    })

    it("ignores closeLobby from a non-host connection", () => {
        const game = new PipPipGame()
        const host = game.createPlayer("AA")
        game.createPlayer("BB")
        game.setHost(host)

        const hostConn = stubConnection("AA")
        const otherConn = stubConnection("BB")
        // The non-host "BB" sends the close request.
        const { context, removed } = stubContext(game, "BB", [hostConn, otherConn])

        processLobbyPackets(context)

        // Nobody is notified and the lobby is left intact.
        expect(hostConn.sent).toHaveLength(0)
        expect(otherConn.sent).toHaveLength(0)
        expect(removed).toEqual([])
    })

    it("does not change game phase when the host closes the lobby", () => {
        const game = new PipPipGame()
        const host = game.createPlayer("AA")
        game.setHost(host)

        const hostConn = stubConnection("AA")
        const { context } = stubContext(game, "AA", [hostConn])

        processLobbyPackets(context)

        // Closing is a teardown, not a phase transition; the game stays in SETUP.
        expect(game.phase).toBe(PipPipGamePhase.SETUP)
    })
})
