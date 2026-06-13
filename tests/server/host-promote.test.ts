import { describe, expect, it } from "vitest"
import { PipPipGame, PipPipGamePhase } from "@pip-pip/game/src/logic"
import { isHostPromoteCommand, processLobbyPackets } from "@pip-pip/server/src/connection-in"

describe("isHostPromoteCommand", () => {
    it("recognizes /op and /makehost (case-insensitive, with args)", () => {
        expect(isHostPromoteCommand("/op AA")).toBe(true)
        expect(isHostPromoteCommand("/OP Bob")).toBe(true)
        expect(isHostPromoteCommand("  /op  Bob  ")).toBe(true)
        expect(isHostPromoteCommand("/makehost BB")).toBe(true)
        expect(isHostPromoteCommand("/MakeHost player two")).toBe(true)
    })

    it("does not treat ordinary chat as a command", () => {
        expect(isHostPromoteCommand("hello")).toBe(false)
        expect(isHostPromoteCommand("/option menu")).toBe(false)
        expect(isHostPromoteCommand("please /op me")).toBe(false)
        expect(isHostPromoteCommand("")).toBe(false)
    })
})

// Mirrors tests/server/bot-commands.test.ts: a minimal lobby-events stub whose
// filter("packetMessage") yields one scripted chat message from `connectionId`.
// processLobbyPackets only reads game + lobbyEvents.filter(...), so this drives
// the real host gating + command dispatch without a websocket Connection.
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

describe("host promote-command dispatch via processLobbyPackets", () => {
    it("reassigns the host by player name (case-insensitive)", () => {
        const game = new PipPipGame()
        const host = game.createPlayer("AA")
        const other = game.createPlayer("BB")
        other.setName("Maverick")
        game.setHost(host)

        processLobbyPackets(stubContext(game, "AA", "/op maverick"))

        expect(game.host?.id).toBe("BB")
    })

    it("reassigns the host by 2-char id", () => {
        const game = new PipPipGame()
        const host = game.createPlayer("AA")
        game.createPlayer("BB")
        game.setHost(host)

        processLobbyPackets(stubContext(game, "AA", "/makehost BB"))

        expect(game.host?.id).toBe("BB")
    })

    it("is a no-op when the target name does not exist", () => {
        const game = new PipPipGame()
        const host = game.createPlayer("AA")
        game.createPlayer("BB")
        game.setHost(host)

        processLobbyPackets(stubContext(game, "AA", "/op nobody"))

        expect(game.host?.id).toBe("AA")
    })

    it("is a no-op when no target is supplied", () => {
        const game = new PipPipGame()
        const host = game.createPlayer("AA")
        game.createPlayer("BB")
        game.setHost(host)

        processLobbyPackets(stubContext(game, "AA", "/op"))

        expect(game.host?.id).toBe("AA")
    })

    it("ignores promote commands from a non-host connection", () => {
        const game = new PipPipGame()
        const host = game.createPlayer("AA")
        const other = game.createPlayer("BB")
        game.setHost(host)
        expect(other.id).toBe("BB")

        processLobbyPackets(stubContext(game, "BB", "/op BB"))

        expect(game.host?.id).toBe("AA")
    })

    it("does not change game phase when dispatching a promote command", () => {
        const game = new PipPipGame()
        const host = game.createPlayer("AA")
        game.createPlayer("BB")
        game.setHost(host)

        processLobbyPackets(stubContext(game, "AA", "/op BB"))

        expect(game.phase).toBe(PipPipGamePhase.SETUP)
    })
})
