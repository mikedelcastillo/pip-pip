import { describe, expect, it } from "vitest"
import {
    mapPreviewTransform,
    worldToPreview,
    backgroundToCss,
    MapPreviewBounds,
} from "../../packages/client/src/game/mapPreview"

const square: MapPreviewBounds = {
    min: { x: -100, y: -100 },
    max: { x: 100, y: 100 },
}

describe("mapPreviewTransform", () => {
    it("fits a square map centred with uniform scale", () => {
        // 200x200 world into a 96x72 thumbnail, padding 0: the limiting axis is
        // height, so scale = 72/200 = 0.36, and the map is centred horizontally.
        const t = mapPreviewTransform(square, 96, 72, 0)
        expect(t.scale).toBeCloseTo(0.36)
        // World centre maps to thumbnail centre on both axes.
        const c = worldToPreview(0, 0, t)
        expect(c.x).toBeCloseTo(48)
        expect(c.y).toBeCloseTo(36)
    })

    it("preserves aspect ratio (no per-axis stretch)", () => {
        // A wide map should not fill the full height: equal world spans map to
        // equal pixel spans on both axes.
        const wide: MapPreviewBounds = {
            min: { x: -200, y: -50 },
            max: { x: 200, y: 50 },
        }
        const t = mapPreviewTransform(wide, 96, 72, 0)
        // 400 wide vs 100 tall: width is limiting → scale = 96/400 = 0.24.
        expect(t.scale).toBeCloseTo(0.24)
        const top = worldToPreview(0, -50, t)
        const bottom = worldToPreview(0, 50, t)
        // 100 world units tall * 0.24 = 24px, centred in 72 → 24..48.
        expect(top.y).toBeCloseTo(24)
        expect(bottom.y).toBeCloseTo(48)
    })

    it("insets the map by the padding", () => {
        const t = mapPreviewTransform(square, 100, 100, 10)
        // Inner box is 80x80, square map → scale = 80/200 = 0.4.
        expect(t.scale).toBeCloseTo(0.4)
        const min = worldToPreview(-100, -100, t)
        expect(min.x).toBeCloseTo(10)
        expect(min.y).toBeCloseTo(10)
        const max = worldToPreview(100, 100, t)
        expect(max.x).toBeCloseTo(90)
        expect(max.y).toBeCloseTo(90)
    })

    it("collapses a degenerate (zero-extent) map to the centre", () => {
        const point: MapPreviewBounds = {
            min: { x: 5, y: 5 },
            max: { x: 5, y: 5 },
        }
        const t = mapPreviewTransform(point, 96, 72, 4)
        const p = worldToPreview(5, 5, t)
        expect(p.x).toBeCloseTo(48)
        expect(p.y).toBeCloseTo(36)
    })
})

describe("backgroundToCss", () => {
    it("formats a 0xRRGGBB number as a padded hex string", () => {
        expect(backgroundToCss(0x150E12)).toBe("#150e12")
        expect(backgroundToCss(0x0A1226)).toBe("#0a1226")
    })

    it("zero-pads small values to six digits", () => {
        expect(backgroundToCss(0x000010)).toBe("#000010")
        expect(backgroundToCss(0)).toBe("#000000")
    })
})
