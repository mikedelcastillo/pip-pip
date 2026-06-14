import { describe, expect, it } from "vitest"
import { PipPipGame } from "@pip-pip/game/src/logic"
import { processChatMessages, getApprovedChatEntries } from "@pip-pip/server/src/connection-in"

// Build a stub GameTickContext whose lobby.server.connections lists EVERY live
// connection on the (simulated) server. pruneChatState reads this to tell a
// connection that merely lives in ANOTHER lobby apart from one that has actually
// disconnected. (processChatMessages otherwise only reads game.players +
// lobbyEvents.filter("packetMessage"), so no real websocket is needed.)
function stubContext(game: PipPipGame, entries: [string, string][], serverConnectionIds: string[]){
    const events = entries.map(([id, message]) => ({
        packetMessage: { connection: { id }, packets: { sendChat: [{ message }] } },
    }))
    const connections: Record<string, object> = {}
    for(const id of serverConnectionIds) connections[id] = {}
    const lobbyEvents = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        filter: (name: string) => (name === "packetMessage" ? events : []) as any,
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { game, lobbyEvents, lobby: { server: { connections } } } as any
}

function approvedFor(id: string){
    const entry = getApprovedChatEntries().find(([senderId]) => senderId === id)
    return entry ? entry[1] : []
}

// Regression: chatRateStates is one server-wide map, but pruneChatState used to
// prune against a single lobby's game.players. With 2+ live lobbies, each lobby's
// tick deleted every OTHER lobby's bucket, and takeChatToken re-seeded the missing
// id with a full burst, so the flood limiter was defeated for every multi-lobby
// player. It now prunes against lobby.server.connections instead.
describe("chat rate limit survives another lobby's tick (multi-lobby)", () => {
    it("does not reset a player's bucket when a different lobby prunes", () => {
        const A = "ML_A", B = "ML_B"
        const both = [A, B]

        // Lobby B: player B floods, exhausting its 5-token burst in one tick.
        const gameB = new PipPipGame()
        gameB.createPlayer(B)
        const flood: [string, string][] = []
        for(let i = 0; i < 6; i++) flood.push([B, "msg" + i])
        processChatMessages(stubContext(gameB, flood, both))
        // Burst is 5; the 6th is rate-limited, so the bucket is now drained.
        expect(approvedFor(B).length).toBe(5)

        // Lobby A ticks. B is NOT in A's game.players but IS a live server conn.
        const gameA = new PipPipGame()
        gameA.createPlayer(A)
        processChatMessages(stubContext(gameA, [[A, "hello"]], both))

        // B sends again immediately: the bucket must still be drained (no fresh
        // burst handed back by A's prune). Before the fix this approved 1 message.
        processChatMessages(stubContext(gameB, [[B, "again"]], both))
        expect(approvedFor(B).length).toBe(0)
    })

    it("still prunes a bucket once the connection leaves the whole server", () => {
        const C = "ML_C"

        // C floods and drains its burst.
        const gameC = new PipPipGame()
        gameC.createPlayer(C)
        const flood: [string, string][] = []
        for(let i = 0; i < 6; i++) flood.push([C, "m" + i])
        processChatMessages(stubContext(gameC, flood, [C]))
        expect(approvedFor(C).length).toBe(5)

        // A later tick where C is GONE from the server prunes C's drained bucket.
        const gameOther = new PipPipGame()
        gameOther.createPlayer("ML_OTHER")
        processChatMessages(stubContext(gameOther, [["ML_OTHER", "x"]], ["ML_OTHER"]))

        // C reconnects: as a brand-new connection it gets a fresh burst, proving the
        // bucket WAS pruned on genuine departure (without pruning it would still be
        // drained and this message would be dropped).
        processChatMessages(stubContext(gameC, [[C, "back"]], [C]))
        expect(approvedFor(C).length).toBe(1)
    })
})
