import { describe, expect, it } from "vitest"
import { MAX_BOTS, PipPipGame, PipPipGamePhase } from "@pip-pip/game/src/logic"
import { isBotCommand, processLobbyPackets } from "@pip-pip/server/src/connection-in"

describe("isBotCommand", () => {
    it("recognizes the bot commands (case-insensitive, with args)", () => {
        expect(isBotCommand("/bot")).toBe(true)
        expect(isBotCommand("/BOT")).toBe(true)
        expect(isBotCommand("  /bot  ")).toBe(true)
        expect(isBotCommand("/bots 4")).toBe(true)
        expect(isBotCommand("/Bots 10")).toBe(true)
        expect(isBotCommand("/clearbots")).toBe(true)
    })

    it("does not treat ordinary chat as a command", () => {
        expect(isBotCommand("hello")).toBe(false)
        expect(isBotCommand("/botanist reporting in")).toBe(false)
        expect(isBotCommand("nice /bot")).toBe(false)
        expect(isBotCommand("")).toBe(false)
    })
})

// Build a fake lobby-events collector whose filter("packetMessage") returns one
// scripted chat message from `connectionId`. processLobbyPackets only reads
// game + lobbyEvents.filter(...), so a minimal stub exercises the real host
// gating and command dispatch without standing up a websocket Connection.
function stubContext(game: PipPipGame, connectionId: string, message: string){
    const events = [
        {
            packetMessage: {
                connection: { id: connectionId },
                packets: { sendChat: [{ message }] },
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

describe("host bot-command dispatch via processLobbyPackets", () => {
    it("adds a bot when the host sends /bot", () => {
        const game = new PipPipGame()
        const host = game.createPlayer("AA")
        game.setHost(host)

        processLobbyPackets(stubContext(game, "AA", "/bot"))

        const bots = Object.values(game.players).filter(p => p.isBot)
        expect(bots.length).toBe(1)
    })

    it("adds N bots when the host sends /bots N", () => {
        const game = new PipPipGame()
        const host = game.createPlayer("AA")
        game.setHost(host)

        processLobbyPackets(stubContext(game, "AA", "/bots 4"))

        expect(Object.values(game.players).filter(p => p.isBot).length).toBe(4)
    })

    it("caps an oversized /bots request at the MAX_BOTS hard limit", () => {
        const game = new PipPipGame()
        const host = game.createPlayer("AA")
        game.setHost(host)

        processLobbyPackets(stubContext(game, "AA", "/bots 9999"))

        // The per-command clamp is 16, but the authoritative MAX_BOTS hard cap
        // (8) wins, so a single match can never hold more than 8 bots.
        expect(Object.values(game.players).filter(p => p.isBot).length).toBe(MAX_BOTS)
    })

    it("removes all bots when the host sends /clearbots", () => {
        const game = new PipPipGame()
        const host = game.createPlayer("AA")
        game.setHost(host)
        game.addBots(3)
        expect(Object.values(game.players).filter(p => p.isBot).length).toBe(3)

        processLobbyPackets(stubContext(game, "AA", "/clearbots"))

        expect(Object.values(game.players).filter(p => p.isBot).length).toBe(0)
        // The host (a real player) is untouched.
        expect("AA" in game.players).toBe(true)
    })

    it("ignores bot commands from a non-host connection", () => {
        const game = new PipPipGame()
        const host = game.createPlayer("AA")
        const other = game.createPlayer("BB")
        game.setHost(host)
        expect(other.id).toBe("BB")

        processLobbyPackets(stubContext(game, "BB", "/bots 5"))

        expect(Object.values(game.players).filter(p => p.isBot).length).toBe(0)
    })

    it("does not start a match for the SETUP-phase no-op path", () => {
        // Sanity: dispatching a command must not change game phase.
        const game = new PipPipGame()
        const host = game.createPlayer("AA")
        game.setHost(host)
        processLobbyPackets(stubContext(game, "AA", "/bot"))
        expect(game.phase).toBe(PipPipGamePhase.SETUP)
    })
})
