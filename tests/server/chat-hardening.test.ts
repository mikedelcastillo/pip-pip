import { describe, expect, it } from "vitest"
import { PipPipGame } from "@pip-pip/game/src/logic"
import { CHAT_MAX_MESSAGE_LENGTH } from "@pip-pip/game/src/logic/constants"
import {
    processChatMessages,
    getApprovedChatEntries,
    sanitizeChatMessage,
} from "@pip-pip/server/src/connection-in"

// Minimal lobbyEvents stub: filter("packetMessage") yields one scripted chat
// event per (connectionId, message) pair. processChatMessages only reads
// game.players + lobbyEvents.filter("packetMessage"), so this exercises the real
// validation + rate limit without a websocket Connection.
function stubContext(game: PipPipGame, entries: [string, string][]){
    const events = entries.map(([id, message]) => ({
        packetMessage: {
            connection: { id },
            packets: { sendChat: [{ message }] },
        },
    }))
    const lobbyEvents = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        filter: (name: string) => (name === "packetMessage" ? events : []) as any,
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { game, lobbyEvents } as any
}

function approvedFor(id: string){
    const entry = getApprovedChatEntries().find(([senderId]) => senderId === id)
    return entry ? entry[1] : []
}

describe("sanitizeChatMessage (H1)", () => {
    it("drops empty / whitespace-only messages", () => {
        expect(sanitizeChatMessage("")).toBeUndefined()
        expect(sanitizeChatMessage("   ")).toBeUndefined()
        expect(sanitizeChatMessage("\t\n  ")).toBeUndefined()
    })

    it("trims and keeps real messages", () => {
        expect(sanitizeChatMessage("  hello  ")).toBe("hello")
    })

    it("clamps to CHAT_MAX_MESSAGE_LENGTH", () => {
        const long = "a".repeat(CHAT_MAX_MESSAGE_LENGTH + 200)
        const clean = sanitizeChatMessage(long)
        expect(clean?.length).toBe(CHAT_MAX_MESSAGE_LENGTH)
    })
})

// Each test uses a DISTINCT sender id so the module-level per-connection
// rate-limit bucket never bleeds token state from one test into the next.
describe("processChatMessages broadcast approval (H1)", () => {
    it("approves a single valid message", () => {
        const game = new PipPipGame()
        game.createPlayer("c1")
        processChatMessages(stubContext(game, [["c1", "hi there"]]))
        expect(approvedFor("c1")).toEqual(["hi there"])
    })

    it("drops empty/whitespace messages server-side (never broadcast)", () => {
        const game = new PipPipGame()
        game.createPlayer("c2")
        processChatMessages(stubContext(game, [["c2", "   "]]))
        expect(approvedFor("c2")).toEqual([])
    })

    it("clamps an oversized message before broadcast", () => {
        const game = new PipPipGame()
        game.createPlayer("c3")
        const long = "z".repeat(CHAT_MAX_MESSAGE_LENGTH + 50)
        processChatMessages(stubContext(game, [["c3", long]]))
        const approved = approvedFor("c3")
        expect(approved.length).toBe(1)
        expect(approved[0].length).toBe(CHAT_MAX_MESSAGE_LENGTH)
    })

    it("rate-limits a flood from one connection", () => {
        const game = new PipPipGame()
        game.createPlayer("c4")
        // 50 messages in a single tick (same Date.now()) — only the burst
        // capacity should pass; the rest are dropped.
        const entries: [string, string][] = []
        for(let i = 0; i < 50; i++) entries.push(["c4", "spam" + i])
        processChatMessages(stubContext(game, entries))
        const approved = approvedFor("c4")
        expect(approved.length).toBeGreaterThan(0)
        expect(approved.length).toBeLessThanOrEqual(5) // CHAT_BURST
    })

    it("rebuilds the approved set each tick (no stale carryover)", () => {
        const game = new PipPipGame()
        game.createPlayer("c5")
        processChatMessages(stubContext(game, [["c5", "first"]]))
        expect(approvedFor("c5")).toEqual(["first"])
        // A tick with no chat clears the previous approvals.
        processChatMessages(stubContext(game, []))
        expect(approvedFor("c5")).toEqual([])
    })

    it("ignores chat from a connection with no player", () => {
        const game = new PipPipGame()
        processChatMessages(stubContext(game, [["ghost", "boo"]]))
        expect(approvedFor("ghost")).toEqual([])
    })
})
