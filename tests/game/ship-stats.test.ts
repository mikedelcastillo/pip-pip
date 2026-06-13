import { describe, expect, it } from "vitest"
import { DEFAULT_SHIP_STATS, createRange, createShipStats } from "@pip-pip/game/src/logic/ship"

describe("createRange", () => {
    it("builds a symmetric low/normal/high band", () => {
        expect(createRange(100)).toEqual({ low: 80, normal: 100, high: 120 })
        expect(createRange(50, 0.5)).toEqual({ low: 25, normal: 50, high: 75 })
    })
})

describe("createShipStats", () => {
    it("returns the full default stat block when given no overrides", () => {
        expect(createShipStats()).toEqual(DEFAULT_SHIP_STATS)
    })

    it("deep-merges partial overrides while keeping sibling defaults", () => {
        const stats = createShipStats({ weapon: { capacity: 99 } })
        expect(stats.weapon.capacity).toBe(99)
        // Siblings inside the overridden branch fall back to defaults.
        expect(stats.weapon.rate).toBe(DEFAULT_SHIP_STATS.weapon.rate)
        // Unrelated branches are untouched.
        expect(stats.health.capacity.normal).toBe(DEFAULT_SHIP_STATS.health.capacity.normal)
        expect(stats.bullet.velocity).toBe(DEFAULT_SHIP_STATS.bullet.velocity)
    })

    it("does not mutate the shared DEFAULT_SHIP_STATS template", () => {
        const before = DEFAULT_SHIP_STATS.weapon.capacity
        createShipStats({ weapon: { capacity: 1 } })
        expect(DEFAULT_SHIP_STATS.weapon.capacity).toBe(before)
    })
})
