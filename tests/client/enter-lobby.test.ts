import { describe, expect, it } from "vitest"
import { enterLobby } from "@pip-pip/client/src/game/enterLobby"

// Regression for the game-breaking bug: host a game, leave WITHOUT reloading,
// host another - and you get dropped into the EXISTING game instead of a fresh
// lobby, unable to host a new one.
//
// Root cause: leaving only closes the websocket; it never leaves the lobby, so
// the reused connection still belongs to the OLD lobby server-side. The server
// blasts a FULL game-state snapshot (players, phase, map) to a connection the
// instant its socket (re)connects. The old entry sequence opened the socket
// FIRST and only then joined the new lobby, so that first snapshot was the OLD
// lobby's and it leaked into the fresh game world.
//
// enterLobby fixes the ORDER: join (HTTP) BEFORE opening the socket, so the only
// snapshot a client ever receives is the lobby it actually meant to enter.

// A fake client modelling the server's "snapshot on socket connect" behaviour.
// connect() captures which lobby the connection is in AT THE MOMENT the socket
// opens - that is exactly the lobby whose full state the real server would push.
function makeFakeClient(initialLobby: string | undefined) {
    const state = {
        currentLobby: initialLobby, // lobby the connection belongs to (server-side)
        socketOpen: false,
        snapshotLobby: undefined as string | undefined, // lobby we were synced into
        calls: [] as string[],
    }
    const client = {
        async requestConnectionIfNeeded() {
            state.calls.push("requestConnectionIfNeeded")
        },
        async joinLobby(id: string) {
            state.calls.push("joinLobby:" + id)
            state.currentLobby = id // the server moves the connection between lobbies
            return {}
        },
        async connect() {
            state.calls.push("connect")
            // Opening the socket makes the server push the CURRENT lobby's full
            // state to this connection (reconnect un-idles -> getFullGameState).
            state.socketOpen = true
            state.snapshotLobby = state.currentLobby
        },
    }
    return { client, state }
}

describe("enterLobby", () => {
    it("joins the target lobby BEFORE opening the socket (the hosting bug)", async () => {
        // The reused connection still belongs to a PREVIOUS lobby "A".
        const { client, state } = makeFakeClient("A")

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await enterLobby(client as any, "B")

        // The only snapshot we received is the lobby we meant to enter - NOT "A".
        expect(state.snapshotLobby).toBe("B")
        // And concretely: the join resolved before the socket opened.
        expect(state.calls).toEqual(["requestConnectionIfNeeded", "joinLobby:B", "connect"])
    })

    it("works on a brand-new connection with no prior lobby", async () => {
        const { client, state } = makeFakeClient(undefined)

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await enterLobby(client as any, "B")

        expect(state.snapshotLobby).toBe("B")
        expect(state.calls).toEqual(["requestConnectionIfNeeded", "joinLobby:B", "connect"])
    })

    it("re-entering the SAME lobby still only ever syncs that lobby", async () => {
        const { client, state } = makeFakeClient("A")

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await enterLobby(client as any, "A")

        expect(state.snapshotLobby).toBe("A")
    })
})
