import { describe, expect, it } from "vitest"
import { Connection } from "@pip-pip/core/src/networking/connection"

// Minimal stub server (same shape as connection-idle-timer.test.ts).
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

// A stand-in for a ws WebSocket: records listeners + closed state and can fire
// events on demand. Connection only touches on/off/close (+ readyState/OPEN/send).
function makeSocket(){
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const listeners: Record<string, ((...args: any[]) => void)[]> = {}
    return {
        closed: false,
        readyState: 1,
        OPEN: 1,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        on(event: string, cb: (...args: any[]) => void){ (listeners[event] ||= []).push(cb) },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        off(event: string, cb: (...args: any[]) => void){ listeners[event] = (listeners[event] || []).filter(f => f !== cb) },
        close(){ this.closed = true },
        send(){ /* no-op */ },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        fire(event: string, ...args: any[]){ for(const cb of (listeners[event] || []).slice()) cb(...args) },
        listenerCount(event: string){ return (listeners[event] || []).length },
    }
}

// Regression: handleSocketClose/removeWebSocket operated on whatever connection.ws
// currently was, and setWebSocket adopted a new socket without detaching/closing the
// old one. On a half-open reconnect (the client opens socket B reusing the same
// Connection), the stale socket A's LATE OS-level close then ran removeWebSocket()
// against the live socket B and killed the fresh session.
describe("Connection reconnect / socket replacement", () => {
    it("discards the old socket when a new one is adopted", () => {
        const conn = makeConnection()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const a: any = makeSocket()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const b: any = makeSocket()

        conn.setWebSocket(a)
        conn.setWebSocket(b)

        expect(conn.ws).toBe(b)
        expect(a.closed).toBe(true)                 // old socket closed on replace
        expect(a.listenerCount("close")).toBe(0)    // its handlers detached
        expect(a.listenerCount("message")).toBe(0)

        conn.destroy()
    })

    it("ignores a stale socket's late close, keeping the reconnected socket alive", () => {
        const conn = makeConnection()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const a: any = makeSocket()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const b: any = makeSocket()

        conn.setWebSocket(a)
        conn.setWebSocket(b) // reconnect: b supersedes a

        // a's OS-level close finally fires, long after the client reconnected on b.
        a.fire("close")

        expect(b.closed).toBe(false)   // the live session survives
        expect(conn.ws).toBe(b)

        conn.destroy()
    })

    it("does not forward a stale socket's message after reconnect", () => {
        const conn = makeConnection()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const a: any = makeSocket()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const b: any = makeSocket()
        let messages = 0
        conn.events.on("socketMessage", () => { messages += 1 })

        conn.setWebSocket(a)
        conn.setWebSocket(b)

        a.fire("message", "stale") // a was detached -> ignored
        expect(messages).toBe(0)
        b.fire("message", "live")  // b is current -> forwarded
        expect(messages).toBe(1)

        conn.destroy()
    })

    it("still tears down on the CURRENT socket's close (normal disconnect)", () => {
        const conn = makeConnection()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const a: any = makeSocket()
        let socketClosed = 0
        conn.events.on("socketClose", () => { socketClosed += 1 })

        conn.setWebSocket(a)
        a.fire("close") // a is current -> teardown runs

        expect(socketClosed).toBe(1)
        expect(a.closed).toBe(true)
        expect(conn.ws).toBeUndefined()

        conn.destroy()
    })
})
