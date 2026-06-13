import { describe, expect, it } from "vitest"
import { exceedsSnapDistance } from "../../packages/client/src/game/interpolation"

const MAX = 250

describe("exceedsSnapDistance", () => {
    it("does not snap for a small delta within range", () => {
        expect(exceedsSnapDistance(10, 10, MAX)).toBe(false)
    })

    it("snaps for a large horizontal-only jump", () => {
        expect(exceedsSnapDistance(300, 0, MAX)).toBe(true)
    })

    // The exact regression: the old `dx*dx + dy + dy` formula evaluated this as
    // 0 + 300 + 300 = 600, which is < 250² = 62500, so a large vertical jump
    // never snapped. The correct squared distance (90000) does exceed it.
    it("snaps for a large vertical-only jump (the H2 regression)", () => {
        expect(exceedsSnapDistance(0, 300, MAX)).toBe(true)
    })

    it("snaps for a large negative vertical jump", () => {
        expect(exceedsSnapDistance(0, -300, MAX)).toBe(true)
    })

    it("does not snap exactly at the boundary (strictly greater)", () => {
        expect(exceedsSnapDistance(MAX, 0, MAX)).toBe(false)
    })

    it("snaps just past the boundary", () => {
        expect(exceedsSnapDistance(MAX + 1, 0, MAX)).toBe(true)
    })

    it("is symmetric in dx and dy", () => {
        expect(exceedsSnapDistance(300, 0, MAX)).toBe(exceedsSnapDistance(0, 300, MAX))
    })
})
