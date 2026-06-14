import { describe, expect, it, vi } from "vitest"
import { matchLeader, GameStorePlayer } from "../../packages/client/src/game/store"

// ObjectiveMeter pulls in its own Sass module and the store hooks. This suite
// only exercises the pure helpers (the leader picker, which lives in the store,
// and the mm:ss clock formatter, which ObjectiveMeter exports), so we stub the
// component's Sass module and the store HOOK (the pure matchLeader export stays
// real). That keeps the import cheap and DOM-free.
vi.mock("../../packages/client/src/components/ObjectiveMeter.module.sass", () => ({
    default: new Proxy({}, { get: (_target, key) => String(key) }),
}))

import { formatMatchClock } from "../../packages/client/src/components/ObjectiveMeter"

// Minimal GameStorePlayer factory: only the fields matchLeader reads (name,
// score.kills, spectator) matter; the rest are filled with inert defaults.
function makePlayer(overrides: Partial<GameStorePlayer> = {}): GameStorePlayer {
    return {
        id: "id",
        name: "player",
        idle: false,
        spectator: false,
        ping: 0,
        score: { kills: 0, assists: 0, deaths: 0, damage: 0 },
        shipIndex: 0,
        shipType: { id: "", name: "" } as unknown as GameStorePlayer["shipType"],
        isHost: false,
        isClient: false,
        spawned: true,
        spawnTimeout: 0,
        ...overrides,
    }
}

// Convenience: a player with a name and a kill count.
function scorer(name: string, kills: number, extra: Partial<GameStorePlayer> = {}): GameStorePlayer {
    return makePlayer({ name, score: { kills, assists: 0, deaths: 0, damage: 0 }, ...extra })
}

describe("matchLeader", () => {
    it("returns null when nobody has any kills (neutral pre-score state)", () => {
        expect(matchLeader([scorer("a", 0), scorer("b", 0)])).toBeNull()
    })

    it("returns null for an empty roster", () => {
        expect(matchLeader([])).toBeNull()
    })

    it("crowns the single highest-kill player", () => {
        const leader = matchLeader([scorer("a", 2), scorer("b", 5), scorer("c", 1)])
        expect(leader).toEqual({ name: "b", kills: 5 })
    })

    it("breaks a tie in favor of the FIRST such player in the array", () => {
        // a and c both have 4; a comes first, so a is king.
        const leader = matchLeader([scorer("a", 4), scorer("b", 1), scorer("c", 4)])
        expect(leader).toEqual({ name: "a", kills: 4 })
    })

    it("ignores spectators even when they would otherwise lead", () => {
        // The spectator's 9 kills are stale; the live leader is b with 3.
        const leader = matchLeader([
            scorer("ghost", 9, { spectator: true }),
            scorer("b", 3),
        ])
        expect(leader).toEqual({ name: "b", kills: 3 })
    })
})

describe("formatMatchClock", () => {
    it("formats whole minutes and zero-padded seconds", () => {
        expect(formatMatchClock(125)).toBe("2:05")
        expect(formatMatchClock(60)).toBe("1:00")
        expect(formatMatchClock(9)).toBe("0:09")
    })

    it("clamps a spent or negative timer to 0:00 (never negative)", () => {
        expect(formatMatchClock(0)).toBe("0:00")
        expect(formatMatchClock(-5)).toBe("0:00")
    })

    it("floors fractional seconds rather than rounding up", () => {
        expect(formatMatchClock(59.9)).toBe("0:59")
    })
})
