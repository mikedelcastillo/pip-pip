import { describe, expect, it } from "vitest"
import { readyTally } from "../../packages/client/src/game/ready"
import type { ReadyTallyPlayer } from "../../packages/client/src/game/ready"

// readyTally backs the host's "X/Y ready" sub-count in the lobby footer. It is
// pure (plain array + hostId), so these pass plain objects without the store.
// Eligible players = NOT the host and NOT spectators; ready counts how many of
// those have ready === true, total is how many such players exist.

// Small helper to build a player with sensible defaults.
function player(id: string, over: Partial<ReadyTallyPlayer> = {}): ReadyTallyPlayer {
    return { id, ready: false, spectator: false, ...over }
}

describe("readyTally", () => {
    it("returns { ready: 0, total: 0 } for an empty lobby", () => {
        expect(readyTally([], "HOST")).toEqual({ ready: 0, total: 0 })
    })

    it("excludes the host from both ready and total", () => {
        const players = [
            player("HOST", { ready: true }),
            player("AA", { ready: true }),
            player("BB", { ready: false }),
        ]
        // The host is dropped: 2 eligible players, 1 of them ready.
        expect(readyTally(players, "HOST")).toEqual({ ready: 1, total: 2 })
    })

    it("excludes spectators from both ready and total", () => {
        const players = [
            player("HOST"),
            player("AA", { ready: true }),
            player("BB", { ready: true, spectator: true }),
            player("CC", { ready: false }),
        ]
        // BB is a spectator (even though ready), so it never counts.
        expect(readyTally(players, "HOST")).toEqual({ ready: 1, total: 2 })
    })

    it("counts every eligible player when all are ready", () => {
        const players = [
            player("HOST"),
            player("AA", { ready: true }),
            player("BB", { ready: true }),
            player("CC", { ready: true }),
        ]
        expect(readyTally(players, "HOST")).toEqual({ ready: 3, total: 3 })
    })

    it("counts zero ready when none are ready", () => {
        const players = [
            player("HOST"),
            player("AA"),
            player("BB"),
        ]
        expect(readyTally(players, "HOST")).toEqual({ ready: 0, total: 2 })
    })

    it("yields a zero total when only the host and spectators are present", () => {
        const players = [
            player("HOST", { ready: true }),
            player("AA", { ready: true, spectator: true }),
        ]
        expect(readyTally(players, "HOST")).toEqual({ ready: 0, total: 0 })
    })

    it("treats an absent host id as no host (everyone non-spectator counts)", () => {
        const players = [
            player("AA", { ready: true }),
            player("BB", { ready: false }),
        ]
        // No player matches "" so none is dropped as host.
        expect(readyTally(players, "")).toEqual({ ready: 1, total: 2 })
    })
})
