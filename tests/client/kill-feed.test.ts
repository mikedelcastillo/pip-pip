import { describe, expect, it } from "vitest"
import {
    KillEntry,
    KILL_FEED_DURATION_MS,
    visibleKills,
    useGameStore,
} from "../../packages/client/src/game/store"

function makeEntry(overrides: Partial<KillEntry> = {}): KillEntry {
    return {
        id: 1,
        killerName: "killer",
        killedName: "killed",
        time: 0,
        ...overrides,
    }
}

describe("visibleKills", () => {
    it("excludes entries older than the duration", () => {
        const now = 10_000
        const stale = makeEntry({ id: 1, time: now - KILL_FEED_DURATION_MS - 1 })
        const result = visibleKills([stale], now)
        expect(result).toHaveLength(0)
    })

    it("includes entries younger than the duration", () => {
        const now = 10_000
        const fresh = makeEntry({ id: 1, time: now - 1 })
        const result = visibleKills([fresh], now)
        expect(result).toHaveLength(1)
        expect(result[0].id).toBe(1)
    })

    it("treats an entry exactly at the duration boundary as expired", () => {
        const now = 10_000
        const boundary = makeEntry({ id: 1, time: now - KILL_FEED_DURATION_MS })
        expect(visibleKills([boundary], now)).toHaveLength(0)
    })

    it("returns visible entries newest first", () => {
        const now = 10_000
        const older = makeEntry({ id: 1, time: now - 3000 })
        const newer = makeEntry({ id: 2, time: now - 1000 })
        // Feed is appended oldest-to-newest; the selector reverses to newest-first.
        const result = visibleKills([older, newer], now)
        expect(result.map((e) => e.id)).toEqual([2, 1])
    })

    it("drops only the stale entries from a mixed feed", () => {
        const now = 10_000
        const stale = makeEntry({ id: 1, time: now - KILL_FEED_DURATION_MS - 100 })
        const fresh = makeEntry({ id: 2, time: now - 500 })
        const result = visibleKills([stale, fresh], now)
        expect(result.map((e) => e.id)).toEqual([2])
    })

    it("honors a custom durationMs override", () => {
        const now = 10_000
        const entry = makeEntry({ id: 1, time: now - 2000 })
        expect(visibleKills([entry], now, 1000)).toHaveLength(0)
        expect(visibleKills([entry], now, 3000)).toHaveLength(1)
    })

    it("returns an empty array for an empty feed", () => {
        expect(visibleKills([], 10_000)).toEqual([])
    })
})

describe("addKill", () => {
    it("records the killer's shipIndex on the entry so the feed can show their glyph", () => {
        useGameStore.setState({ killFeed: [] })
        useGameStore.getState().addKill("killer", "killed", 3)
        const feed = useGameStore.getState().killFeed
        expect(feed).toHaveLength(1)
        expect(feed[0].killerName).toBe("killer")
        expect(feed[0].killedName).toBe("killed")
        expect(feed[0].killerShipIndex).toBe(3)
    })

    it("leaves killerShipIndex undefined when the killer's ship is unknown", () => {
        useGameStore.setState({ killFeed: [] })
        useGameStore.getState().addKill("ghost", "victim")
        const feed = useGameStore.getState().killFeed
        expect(feed).toHaveLength(1)
        expect(feed[0].killerShipIndex).toBeUndefined()
    })
})
