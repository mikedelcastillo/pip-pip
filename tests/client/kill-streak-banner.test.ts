import { describe, expect, it, vi } from "vitest"

// KillStreakBanner imports its own Sass module, the store hooks, and (through
// ../game) the whole GAME_CONTEXT with its Pixi renderer + audio. This suite only
// exercises the pure helpers it exports (currentMultiKill + multiKillTier), so we
// stub those heavy imports. That keeps the import cheap and DOM-free while the
// helpers themselves load untouched. The KillEntry type comes in type-only, so it
// needs no runtime stub.
vi.mock("../../packages/client/src/components/KillStreakBanner.module.sass", () => ({
    default: new Proxy({}, { get: (_target, key) => String(key) }),
}))
vi.mock("../../packages/client/src/game/store", () => ({
    useGameStore: () => undefined,
}))
vi.mock("../../packages/client/src/game", () => ({
    GAME_CONTEXT: { audio: { play: () => undefined } },
}))

import type { KillEntry } from "../../packages/client/src/game/store"
import {
    MULTI_KILL_WINDOW_MS,
    currentMultiKill,
    multiKillTier,
} from "../../packages/client/src/components/KillStreakBanner"

function makeEntry(overrides: Partial<KillEntry> = {}): KillEntry {
    return {
        id: 1,
        killerName: "ME",
        killedName: "victim",
        time: 0,
        ...overrides,
    }
}

describe("multiKillTier", () => {
    it("returns null below two kills", () => {
        expect(multiKillTier(0)).toBeNull()
        expect(multiKillTier(1)).toBeNull()
    })

    it("maps each count to its escalating label", () => {
        expect(multiKillTier(2)?.label).toBe("Double Kill")
        expect(multiKillTier(3)?.label).toBe("Triple Kill")
        expect(multiKillTier(4)?.label).toBe("Multi Kill")
        expect(multiKillTier(5)?.label).toBe("Monster Kill")
    })

    it("keeps the top tier for any count of five or more", () => {
        expect(multiKillTier(6)?.label).toBe("Monster Kill")
        expect(multiKillTier(99)?.label).toBe("Monster Kill")
    })

    it("carries the raw count through on the tier", () => {
        expect(multiKillTier(3)?.count).toBe(3)
        expect(multiKillTier(7)?.count).toBe(7)
    })
})

describe("currentMultiKill", () => {
    it("returns null when the local player has no kills", () => {
        const now = 10_000
        const other = makeEntry({ killerName: "RIVAL", time: now - 100 })
        expect(currentMultiKill([other], "ME", now)).toBeNull()
    })

    it("returns null for a single kill (nothing to celebrate)", () => {
        const now = 10_000
        const feed = [makeEntry({ time: now - 100 })]
        expect(currentMultiKill(feed, "ME", now)).toBeNull()
    })

    it("reaches Double Kill on two kills inside the window", () => {
        const now = 10_000
        const feed = [
            makeEntry({ id: 1, time: now - 2000 }),
            makeEntry({ id: 2, time: now - 500 }),
        ]
        const tier = currentMultiKill(feed, "ME", now)
        expect(tier?.label).toBe("Double Kill")
        expect(tier?.count).toBe(2)
    })

    it("escalates to Triple Kill on three kills inside the window", () => {
        const now = 10_000
        const feed = [
            makeEntry({ id: 1, time: now - 3000 }),
            makeEntry({ id: 2, time: now - 1500 }),
            makeEntry({ id: 3, time: now - 200 }),
        ]
        expect(currentMultiKill(feed, "ME", now)?.label).toBe("Triple Kill")
    })

    it("only counts kills by the LOCAL player, ignoring other players' kills", () => {
        const now = 10_000
        const feed = [
            makeEntry({ id: 1, killerName: "ME", time: now - 1000 }),
            makeEntry({ id: 2, killerName: "RIVAL", time: now - 900 }),
            makeEntry({ id: 3, killerName: "RIVAL", time: now - 800 }),
            makeEntry({ id: 4, killerName: "ME", time: now - 300 }),
        ]
        // Two of the four kills are the local player's: that is a Double Kill, even
        // though the rivals racked up kills inside the same window.
        const tier = currentMultiKill(feed, "ME", now)
        expect(tier?.label).toBe("Double Kill")
        expect(tier?.count).toBe(2)
    })

    it("excludes kills that fell outside the rolling window", () => {
        const now = 10_000
        const feed = [
            // Stale: older than the window, so it does not chain.
            makeEntry({ id: 1, time: now - MULTI_KILL_WINDOW_MS - 1 }),
            makeEntry({ id: 2, time: now - 500 }),
        ]
        // Only one in-window kill remains, which is below the Double Kill threshold.
        expect(currentMultiKill(feed, "ME", now)).toBeNull()
    })

    it("treats a kill exactly at the window edge as expired", () => {
        const now = 10_000
        const feed = [
            makeEntry({ id: 1, time: now - MULTI_KILL_WINDOW_MS }),
            makeEntry({ id: 2, time: now - 100 }),
        ]
        // The edge kill is excluded (strict, like visibleKills), leaving one kill.
        expect(currentMultiKill(feed, "ME", now)).toBeNull()
    })

    it("honors a custom windowMs override", () => {
        const now = 10_000
        const feed = [
            makeEntry({ id: 1, time: now - 2000 }),
            makeEntry({ id: 2, time: now - 500 }),
        ]
        // With a tight 1s window the older kill drops out, so no multi-kill.
        expect(currentMultiKill(feed, "ME", now, 1000)).toBeNull()
        // With a roomy 3s window both kills chain into a Double Kill.
        expect(currentMultiKill(feed, "ME", now, 3000)?.label).toBe("Double Kill")
    })

    it("returns null for a blank local name", () => {
        const now = 10_000
        const feed = [
            makeEntry({ id: 1, killerName: "", time: now - 1000 }),
            makeEntry({ id: 2, killerName: "", time: now - 500 }),
        ]
        // A blank local name must never match stray blank killerNames.
        expect(currentMultiKill(feed, "", now)).toBeNull()
    })

    it("returns null for an empty feed", () => {
        expect(currentMultiKill([], "ME", 10_000)).toBeNull()
    })
})
