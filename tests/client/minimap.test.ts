import { describe, expect, it } from "vitest"
import { worldToMinimap, MinimapBounds } from "../../packages/client/src/game/minimap"

const bounds: MinimapBounds = {
    min: { x: -100, y: -100 },
    max: { x: 100, y: 100 },
}

describe("worldToMinimap", () => {
    it("maps the world centre to the radar centre", () => {
        const p = worldToMinimap(0, 0, bounds, 140)
        expect(p.x).toBeCloseTo(70)
        expect(p.y).toBeCloseTo(70)
    })

    it("maps the min corner to the padded top-left corner", () => {
        const padding = 6
        const p = worldToMinimap(-100, -100, bounds, 140, padding)
        expect(p.x).toBeCloseTo(padding)
        expect(p.y).toBeCloseTo(padding)
    })

    it("maps the max corner to the padded bottom-right corner", () => {
        const padding = 6
        const size = 140
        const p = worldToMinimap(100, 100, bounds, size, padding)
        expect(p.x).toBeCloseTo(size - padding)
        expect(p.y).toBeCloseTo(size - padding)
    })

    it("clamps coordinates beyond the world bounds to the padded edge", () => {
        const padding = 6
        const size = 140
        const below = worldToMinimap(-500, -500, bounds, size, padding)
        expect(below.x).toBeCloseTo(padding)
        expect(below.y).toBeCloseTo(padding)
        const above = worldToMinimap(500, 500, bounds, size, padding)
        expect(above.x).toBeCloseTo(size - padding)
        expect(above.y).toBeCloseTo(size - padding)
    })

    it("centres a zero-extent axis instead of dividing by zero", () => {
        const degenerate: MinimapBounds = {
            min: { x: 50, y: -100 },
            max: { x: 50, y: 100 },
        }
        const p = worldToMinimap(50, 0, degenerate, 140)
        // x extent is zero → centre of the padded span (size / 2); y maps normally.
        expect(p.x).toBeCloseTo(70)
        expect(p.y).toBeCloseTo(70)
        expect(Number.isFinite(p.x)).toBe(true)
    })

    it("centres a fully zero-extent (point) map", () => {
        const point: MinimapBounds = {
            min: { x: 7, y: 7 },
            max: { x: 7, y: 7 },
        }
        const p = worldToMinimap(7, 7, point, 140, 10)
        expect(p.x).toBeCloseTo(70)
        expect(p.y).toBeCloseTo(70)
    })
})
