import { describe, expect, it } from "vitest"
import { shouldReuseConnectedLobby } from "@pip-pip/core/src/networking/client/axios"

// Regression for the production bug where hosting a game dropped you into an
// EXISTING game: joinLobby used to return the connection's current lobby whenever
// it was in one, ignoring the requested id. Hosting creates a fresh lobby and
// then joins it, so a player already in lobby A would create lobby B and get sent
// back to A. joinLobby may now only reuse the current lobby when it is the SAME
// one being requested (a refresh / reconnect).
describe("shouldReuseConnectedLobby", () => {
    it("reuses the current lobby only when it matches the requested id (refresh)", () => {
        expect(shouldReuseConnectedLobby("AAAA", "AAAA")).toBe(true)
    })

    it("does NOT reuse when in a DIFFERENT lobby (this is the hosting bug)", () => {
        // In lobby AAAA, but hosting just created BBBB and is joining it.
        expect(shouldReuseConnectedLobby("AAAA", "BBBB")).toBe(false)
    })

    it("does NOT reuse when the connection is in no lobby yet", () => {
        expect(shouldReuseConnectedLobby(undefined, "AAAA")).toBe(false)
    })
})
