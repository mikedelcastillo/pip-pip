import { describe, expect, it } from "vitest"
import { fraction } from "../../packages/client/src/game/store"

describe("fraction", () => {
    it("returns 0 when max is zero (no divide-by-zero)", () => {
        expect(fraction(5, 0)).toBe(0)
    })

    it("returns 0 when max is negative", () => {
        expect(fraction(5, -10)).toBe(0)
    })

    it("returns the ratio for a value within range", () => {
        expect(fraction(50, 100)).toBe(0.5)
        expect(fraction(30, 120)).toBe(0.25)
    })

    it("returns 1 for a full timer", () => {
        expect(fraction(100, 100)).toBe(1)
    })

    it("returns 0 for a depleted timer", () => {
        expect(fraction(0, 100)).toBe(0)
    })

    it("clamps above 1 when value exceeds max", () => {
        expect(fraction(150, 100)).toBe(1)
    })

    it("clamps below 0 when value is negative", () => {
        expect(fraction(-20, 100)).toBe(0)
    })
})
