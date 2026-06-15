import { describe, expect, it } from "vitest"
import {
    ClientPlayerStats,
    activeBuffs,
} from "../../packages/client/src/game/store"
import { HASTE_TICKS, SHIELD_TICKS, INVIS_TICKS, RICOCHET_TICKS, RAPIDFIRE_TICKS } from "@pip-pip/game/src/logic/powerup"

// A zeroed stats object; tests flip on only the buff fields they care about.
function makeStats(overrides: Partial<ClientPlayerStats> = {}): ClientPlayerStats {
    return {
        reloading: false,
        ammo: 0, ammoMax: 0,
        health: 0, healthMax: 0,
        spawned: true, spawnTimeout: 0,
        shieldTicks: 0, shieldMaxTicks: SHIELD_TICKS,
        hasteTicks: 0, hasteMaxTicks: HASTE_TICKS,
        invisTicks: 0, invisMaxTicks: INVIS_TICKS,
        ricochetTicks: 0, ricochetMaxTicks: RICOCHET_TICKS,
        rapidfireTicks: 0, rapidfireMaxTicks: RAPIDFIRE_TICKS,
        tacticalReloadTicks: 0, tacticalReloadMaxTicks: 0,
        tacticalAmmo: 0, tacticalAmmoMax: 0,
        ...overrides,
    }
}

describe("activeBuffs", () => {
    it("returns no buffs when none are active", () => {
        expect(activeBuffs(makeStats())).toEqual([])
    })

    it("only lists buffs whose ticks are > 0", () => {
        const stats = makeStats({ hasteTicks: 50, shieldTicks: 0, invisTicks: 10, ricochetTicks: 0 })
        const types = activeBuffs(stats).map((b) => b.type)
        expect(types).toContain("haste")
        expect(types).toContain("invis")
        expect(types).not.toContain("shield")
        expect(types).not.toContain("ricochet")
    })

    it("includes ricochet as a listed buff when active", () => {
        const stats = makeStats({ ricochetTicks: RICOCHET_TICKS })
        const types = activeBuffs(stats).map((b) => b.type)
        expect(types).toEqual(["ricochet"])
    })

    it("includes rapidfire as a listed buff when active", () => {
        const stats = makeStats({ rapidfireTicks: RAPIDFIRE_TICKS })
        const buff = activeBuffs(stats)[0]
        expect(buff.type).toBe("rapidfire")
        expect(buff.label).toBe("RAPIDFIRE")
        expect(buff.ticks).toBe(RAPIDFIRE_TICKS)
        expect(buff.maxTicks).toBe(RAPIDFIRE_TICKS)
    })

    it("carries each buff's label, color and tick counts through", () => {
        const stats = makeStats({ hasteTicks: 120 })
        const buff = activeBuffs(stats)[0]
        expect(buff.type).toBe("haste")
        expect(buff.label).toBe("HASTE")
        expect(buff.color).toBe("#33CCFF")
        expect(buff.ticks).toBe(120)
        expect(buff.maxTicks).toBe(HASTE_TICKS)
    })

    it("orders the longest-window buff first, breaking ties by time left", () => {
        // All four active at one tick each: ordering is purely by max window, so
        // the order is strictly duration-descending: ricochet (600), invis (400),
        // shield (300), haste (200).
        const stats = makeStats({
            hasteTicks: 1, shieldTicks: 1, invisTicks: 1, ricochetTicks: 1,
        })
        const order = activeBuffs(stats).map((b) => b.type)
        expect(order).toEqual(["ricochet", "invis", "shield", "haste"])
    })
})
