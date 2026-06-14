import { describe, expect, it } from "vitest"
import { healthOverlayChanged, HealthOverlayState } from "../../packages/client/src/game/renderer"
import { COLORS } from "../../packages/client/src/game/styles"

// healthOverlayChanged(prev, next) decides whether the renderer must clear() +
// redraw a player's static health-bar overlay this frame. It compares the cached
// inputs from the previous draw against the current ones: the health value, the
// max health, and the bar color. Returning true on ANY change (or on the first
// draw) is what keeps the bar from going stale, while returning false on no
// change is the per-frame redraw we are trying to skip.
const base: HealthOverlayState = {
    health: 100,
    maxHealth: 100,
    color: COLORS.GOOD,
}

describe("healthOverlayChanged", () => {
    it("is dirty on the first draw (no previous state)", () => {
        expect(healthOverlayChanged(undefined, base)).toBe(true)
    })

    it("is NOT dirty when nothing changed", () => {
        // Same numbers, even as a distinct object, must be clean so the redraw
        // is skipped. This is the common 60fps case.
        expect(healthOverlayChanged({ ...base }, { ...base })).toBe(false)
    })

    it("is dirty when health changes (e.g. taking damage)", () => {
        expect(healthOverlayChanged(base, { ...base, health: 60 })).toBe(true)
    })

    it("is dirty when health is restored (e.g. respawn / heal pickup)", () => {
        const damaged: HealthOverlayState = { ...base, health: 20 }
        expect(healthOverlayChanged(damaged, { ...damaged, health: 100 })).toBe(true)
    })

    it("is dirty when maxHealth changes", () => {
        expect(healthOverlayChanged(base, { ...base, maxHealth: 150 })).toBe(true)
    })

    it("is dirty when the bar color changes (e.g. a TDM team switch)", () => {
        expect(healthOverlayChanged(base, { ...base, color: COLORS.BAD })).toBe(true)
    })
})
