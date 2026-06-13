import { describe, expect, it } from "vitest"
import { sanitizePlayerInputs } from "@pip-pip/server/src/input-sanitize"

const TWO_PI = Math.PI * 2

describe("sanitizePlayerInputs", () => {
    it("passes valid in-range inputs through untouched", () => {
        const input = { movementAngle: 1.2, movementAmount: 0.5, aimRotation: 2.3 }
        expect(sanitizePlayerInputs(input)).toEqual(input)
    })

    it("keeps the [0,1] amount bounds intact", () => {
        expect(sanitizePlayerInputs({ movementAngle: 0, movementAmount: 0, aimRotation: 0 }).movementAmount).toBe(0)
        expect(sanitizePlayerInputs({ movementAngle: 0, movementAmount: 1, aimRotation: 0 }).movementAmount).toBe(1)
    })

    it("turns NaN floats into safe finite values", () => {
        const out = sanitizePlayerInputs({ movementAngle: NaN, movementAmount: NaN, aimRotation: NaN })
        expect(Number.isFinite(out.movementAngle)).toBe(true)
        expect(Number.isFinite(out.movementAmount)).toBe(true)
        expect(Number.isFinite(out.aimRotation)).toBe(true)
        expect(out.movementAngle).toBe(0)
        expect(out.aimRotation).toBe(0)
        expect(out.movementAmount).toBe(0)
    })

    it("turns Infinity floats into safe finite values", () => {
        const out = sanitizePlayerInputs({
            movementAngle: Infinity,
            movementAmount: Infinity,
            aimRotation: -Infinity,
        })
        expect(Number.isFinite(out.movementAngle)).toBe(true)
        expect(Number.isFinite(out.movementAmount)).toBe(true)
        expect(Number.isFinite(out.aimRotation)).toBe(true)
    })

    it("clamps movementAmount to [0,1]", () => {
        expect(sanitizePlayerInputs({ movementAngle: 0, movementAmount: 5, aimRotation: 0 }).movementAmount).toBe(1)
        expect(sanitizePlayerInputs({ movementAngle: 0, movementAmount: -3, aimRotation: 0 }).movementAmount).toBe(0)
    })

    it("wraps angles into [0, 2*PI)", () => {
        const out = sanitizePlayerInputs({ movementAngle: TWO_PI + 1, movementAmount: 0.5, aimRotation: -1 })
        expect(out.movementAngle).toBeGreaterThanOrEqual(0)
        expect(out.movementAngle).toBeLessThan(TWO_PI)
        expect(out.movementAngle).toBeCloseTo(1, 10)
        expect(out.aimRotation).toBeGreaterThanOrEqual(0)
        expect(out.aimRotation).toBeLessThan(TWO_PI)
        expect(out.aimRotation).toBeCloseTo(TWO_PI - 1, 10)
    })
})
