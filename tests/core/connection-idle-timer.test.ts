import { describe, expect, it } from "vitest"
import { Connection } from "@pip-pip/core/src/networking/connection"

// Minimal stub server: a Connection only reads options + connections at
// construction and calls server.removeConnection / server.events.emit during
// teardown, so no real websocket server is needed to exercise the idle timer.
function stubServer(){
    return {
        options: { connectionIdLength: 8, connectionIdleLifespan: 100000, maxPing: 1000 },
        connections: {} as Record<string, unknown>,
        removeConnection: () => {},
        events: { emit: () => {} },
    }
}

function makeConnection(){
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new Connection(stubServer() as any)
}

// Regression: destroy() calls removeWebSocket(), which ends in startIdle(). With
// no destroyed-guard, a torn-down connection re-armed a ~10-minute setTimeout whose
// closure captures the connection (and the server), leaking both on every
// disconnect / kick / lobby-close.
describe("Connection idle timer lifecycle", () => {
    it("arms an idle timer on construction (no websocket yet)", () => {
        const conn = makeConnection()
        expect(conn.idleTimeout).toBeDefined()
        conn.destroy() // clean up the pending timer
    })

    it("clears the idle timer on destroy and does not re-arm it", () => {
        const conn = makeConnection()
        expect(conn.idleTimeout).toBeDefined()

        conn.destroy()

        expect(conn.destroyed).toBe(true)
        // No live timer may survive teardown (before the fix this stayed armed).
        expect(conn.idleTimeout).toBeUndefined()
    })

    it("startIdle is a no-op once the connection is destroyed", () => {
        const conn = makeConnection()
        conn.destroy()
        conn.startIdle()
        expect(conn.idleTimeout).toBeUndefined()
    })
})
