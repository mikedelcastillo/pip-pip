import { beforeEach, describe, expect, it } from "vitest"
import {
    BuffEntry,
    BuffRemaining,
    BUFF_FEED_DURATION_MS,
    visibleBuffs,
    visibleTacticalBuffs,
    buffRemainingKey,
    isTimedBuff,
    formatBuffTime,
    buffLabel,
    buffColor,
    useGameStore,
} from "../../packages/client/src/game/store"

function makeEntry(overrides: Partial<BuffEntry> = {}): BuffEntry {
    return {
        id: 1,
        playerId: "AA",
        playerName: "player",
        type: "haste",
        time: 0,
        ...overrides,
    }
}

describe("visibleBuffs", () => {
    it("excludes entries older than the duration", () => {
        const now = 10_000
        const stale = makeEntry({ id: 1, time: now - BUFF_FEED_DURATION_MS - 1 })
        const result = visibleBuffs([stale], now)
        expect(result).toHaveLength(0)
    })

    it("includes entries younger than the duration", () => {
        const now = 10_000
        const fresh = makeEntry({ id: 1, time: now - 1 })
        const result = visibleBuffs([fresh], now)
        expect(result).toHaveLength(1)
        expect(result[0].id).toBe(1)
    })

    it("treats an entry exactly at the duration boundary as expired", () => {
        const now = 10_000
        const boundary = makeEntry({ id: 1, time: now - BUFF_FEED_DURATION_MS })
        expect(visibleBuffs([boundary], now)).toHaveLength(0)
    })

    it("returns visible entries newest first", () => {
        const now = 10_000
        const older = makeEntry({ id: 1, time: now - 3000 })
        const newer = makeEntry({ id: 2, time: now - 1000 })
        // Feed is appended oldest-to-newest; the selector reverses to newest-first.
        const result = visibleBuffs([older, newer], now)
        expect(result.map((e) => e.id)).toEqual([2, 1])
    })

    it("drops only the stale entries from a mixed feed", () => {
        const now = 10_000
        const stale = makeEntry({ id: 1, time: now - BUFF_FEED_DURATION_MS - 100 })
        const fresh = makeEntry({ id: 2, time: now - 500 })
        const result = visibleBuffs([stale, fresh], now)
        expect(result.map((e) => e.id)).toEqual([2])
    })

    it("honors a custom durationMs override", () => {
        const now = 10_000
        const entry = makeEntry({ id: 1, time: now - 2000 })
        expect(visibleBuffs([entry], now, 1000)).toHaveLength(0)
        expect(visibleBuffs([entry], now, 3000)).toHaveLength(1)
    })

    it("returns an empty array for an empty feed", () => {
        expect(visibleBuffs([], 10_000)).toEqual([])
    })
})

describe("buffLabel", () => {
    it("maps every buff type to a friendly, shout-y label", () => {
        expect(buffLabel("health")).toBe("HEALTH")
        expect(buffLabel("ammo")).toBe("AMMO")
        expect(buffLabel("haste")).toBe("HASTE")
        expect(buffLabel("shield")).toBe("SHIELD")
        // "invis" reads better as "CLOAK" on screen.
        expect(buffLabel("invis")).toBe("CLOAK")
        expect(buffLabel("ricochet")).toBe("RICOCHET")
        expect(buffLabel("rapidfire")).toBe("RAPIDFIRE")
    })
})

describe("buffColor", () => {
    it("maps every buff type to its HUD/pickup color", () => {
        expect(buffColor("health")).toBe("#33DD55")
        expect(buffColor("ammo")).toBe("#FFAA33")
        expect(buffColor("haste")).toBe("#33CCFF")
        expect(buffColor("shield")).toBe("#AA66FF")
        expect(buffColor("invis")).toBe("#CCE6FF")
        expect(buffColor("ricochet")).toBe("#FF66AA")
        expect(buffColor("rapidfire")).toBe("#FFE14D")
    })
})

describe("isTimedBuff", () => {
    it("treats the timed buff buffs as timed", () => {
        expect(isTimedBuff("haste")).toBe(true)
        expect(isTimedBuff("shield")).toBe(true)
        expect(isTimedBuff("invis")).toBe(true)
        expect(isTimedBuff("ricochet")).toBe(true)
        expect(isTimedBuff("rapidfire")).toBe(true)
    })

    it("treats health and ammo as instant (not timed)", () => {
        expect(isTimedBuff("health")).toBe(false)
        expect(isTimedBuff("ammo")).toBe(false)
    })
})

describe("formatBuffTime", () => {
    it("rounds tick counts UP to whole seconds and renders Ns under a minute", () => {
        // 20 tps: 200 ticks = 10s; a partial second still rounds up so a buff
        // never reads 0s while time is left.
        expect(formatBuffTime(200, 20)).toBe("10s")
        expect(formatBuffTime(1, 20)).toBe("1s")
        expect(formatBuffTime(21, 20)).toBe("2s")
    })

    it("clamps a spent or negative timer to 0s", () => {
        expect(formatBuffTime(0, 20)).toBe("0s")
        expect(formatBuffTime(-5, 20)).toBe("0s")
    })

    it("renders a minute or more as M:SS with a zero-padded seconds field", () => {
        // 60s exactly, and 65s -> 1:05 (zero-padded).
        expect(formatBuffTime(60 * 20, 20)).toBe("1:00")
        expect(formatBuffTime(65 * 20, 20)).toBe("1:05")
    })

    it("returns 0s for a non-positive tick rate (no divide-by-zero)", () => {
        expect(formatBuffTime(100, 0)).toBe("0s")
    })
})

describe("visibleTacticalBuffs", () => {
    const remaining: BuffRemaining = {
        [buffRemainingKey("AA", "haste")]: 120,
    }

    it("keeps a timed-buff entry while the picker still holds the buff", () => {
        const now = 10_000
        // Older than the fixed transient window, but the buff is still active.
        const entry = makeEntry({ id: 1, playerId: "AA", type: "haste", time: now - BUFF_FEED_DURATION_MS - 1000 })
        const result = visibleTacticalBuffs([entry], remaining, now)
        expect(result).toHaveLength(1)
        expect(result[0].remainingTicks).toBe(120)
    })

    it("drops a timed-buff entry once the buff is gone (no remaining ticks)", () => {
        const now = 10_000
        const entry = makeEntry({ id: 1, playerId: "AA", type: "shield", time: now - 100 })
        // shield is not present in `remaining`, so it reads as 0 ticks left.
        expect(visibleTacticalBuffs([entry], remaining, now)).toHaveLength(0)
    })

    it("keeps an instant pickup on the brief fixed window and annotates 0 ticks", () => {
        const now = 10_000
        const fresh = makeEntry({ id: 1, type: "health", time: now - 500 })
        const stale = makeEntry({ id: 2, type: "ammo", time: now - BUFF_FEED_DURATION_MS - 1 })
        const result = visibleTacticalBuffs([fresh, stale], remaining, now)
        expect(result.map((e) => e.id)).toEqual([1])
        expect(result[0].remainingTicks).toBe(0)
    })

    it("returns surviving entries newest first", () => {
        const now = 10_000
        const map: BuffRemaining = {
            [buffRemainingKey("AA", "haste")]: 80,
            [buffRemainingKey("BB", "shield")]: 60,
        }
        const older = makeEntry({ id: 1, playerId: "AA", type: "haste", time: now - 3000 })
        const newer = makeEntry({ id: 2, playerId: "BB", type: "shield", time: now - 1000 })
        const result = visibleTacticalBuffs([older, newer], map, now)
        expect(result.map((e) => e.id)).toEqual([2, 1])
    })

    it("returns an empty array for an empty feed", () => {
        expect(visibleTacticalBuffs([], remaining, 10_000)).toEqual([])
    })
})

describe("addBuffPickup feed identity", () => {
    beforeEach(() => {
        useGameStore.setState({ buffFeed: [] })
    })

    it("keeps only the latest entry for a player's repeated timed buff (no zombie row)", () => {
        const { addBuffPickup } = useGameStore.getState()
        addBuffPickup("AA", "Alice", "haste")
        addBuffPickup("AA", "Alice", "haste") // re-pickup / refresh

        const aaHaste = useGameStore.getState().buffFeed
            .filter((e) => e.playerId === "AA" && e.type === "haste")
        expect(aaHaste).toHaveLength(1)
    })

    it("keeps separate entries for different players and buff types", () => {
        const { addBuffPickup } = useGameStore.getState()
        addBuffPickup("AA", "Alice", "haste")
        addBuffPickup("BB", "Bob", "haste")
        addBuffPickup("AA", "Alice", "shield")
        expect(useGameStore.getState().buffFeed).toHaveLength(3)
    })

    it("gives every entry a unique id, even at the feed cap", () => {
        const { addBuffPickup } = useGameStore.getState()
        // Instant pickups are NOT deduped, so 12 distinct ones exercise the cap.
        for(let i = 0; i < 12; i++) addBuffPickup("p" + i, "n", "health")
        const ids = useGameStore.getState().buffFeed.map((e) => e.id)
        expect(new Set(ids).size).toBe(ids.length)
    })
})
