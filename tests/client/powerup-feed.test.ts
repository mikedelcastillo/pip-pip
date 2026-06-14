import { describe, expect, it } from "vitest"
import {
    PowerupEntry,
    POWERUP_FEED_DURATION_MS,
    visiblePowerups,
    powerupLabel,
    powerupColor,
} from "../../packages/client/src/game/store"

function makeEntry(overrides: Partial<PowerupEntry> = {}): PowerupEntry {
    return {
        id: 1,
        playerName: "player",
        type: "haste",
        time: 0,
        ...overrides,
    }
}

describe("visiblePowerups", () => {
    it("excludes entries older than the duration", () => {
        const now = 10_000
        const stale = makeEntry({ id: 1, time: now - POWERUP_FEED_DURATION_MS - 1 })
        const result = visiblePowerups([stale], now)
        expect(result).toHaveLength(0)
    })

    it("includes entries younger than the duration", () => {
        const now = 10_000
        const fresh = makeEntry({ id: 1, time: now - 1 })
        const result = visiblePowerups([fresh], now)
        expect(result).toHaveLength(1)
        expect(result[0].id).toBe(1)
    })

    it("treats an entry exactly at the duration boundary as expired", () => {
        const now = 10_000
        const boundary = makeEntry({ id: 1, time: now - POWERUP_FEED_DURATION_MS })
        expect(visiblePowerups([boundary], now)).toHaveLength(0)
    })

    it("returns visible entries newest first", () => {
        const now = 10_000
        const older = makeEntry({ id: 1, time: now - 3000 })
        const newer = makeEntry({ id: 2, time: now - 1000 })
        // Feed is appended oldest-to-newest; the selector reverses to newest-first.
        const result = visiblePowerups([older, newer], now)
        expect(result.map((e) => e.id)).toEqual([2, 1])
    })

    it("drops only the stale entries from a mixed feed", () => {
        const now = 10_000
        const stale = makeEntry({ id: 1, time: now - POWERUP_FEED_DURATION_MS - 100 })
        const fresh = makeEntry({ id: 2, time: now - 500 })
        const result = visiblePowerups([stale, fresh], now)
        expect(result.map((e) => e.id)).toEqual([2])
    })

    it("honors a custom durationMs override", () => {
        const now = 10_000
        const entry = makeEntry({ id: 1, time: now - 2000 })
        expect(visiblePowerups([entry], now, 1000)).toHaveLength(0)
        expect(visiblePowerups([entry], now, 3000)).toHaveLength(1)
    })

    it("returns an empty array for an empty feed", () => {
        expect(visiblePowerups([], 10_000)).toEqual([])
    })
})

describe("powerupLabel", () => {
    it("maps every powerup type to a friendly, shout-y label", () => {
        expect(powerupLabel("health")).toBe("HEALTH")
        expect(powerupLabel("ammo")).toBe("AMMO")
        expect(powerupLabel("haste")).toBe("HASTE")
        expect(powerupLabel("shield")).toBe("SHIELD")
        // "invis" reads better as "CLOAK" on screen.
        expect(powerupLabel("invis")).toBe("CLOAK")
    })
})

describe("powerupColor", () => {
    it("maps every powerup type to its HUD/pickup color", () => {
        expect(powerupColor("health")).toBe("#33DD55")
        expect(powerupColor("ammo")).toBe("#FFAA33")
        expect(powerupColor("haste")).toBe("#33CCFF")
        expect(powerupColor("shield")).toBe("#AA66FF")
        expect(powerupColor("invis")).toBe("#CCE6FF")
    })
})
