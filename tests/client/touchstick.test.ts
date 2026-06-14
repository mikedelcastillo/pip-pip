import { describe, expect, it } from "vitest"
import {
    STICK_DEADZONE,
    STICK_RADIUS,
    createStickState,
    stickBegin,
    stickEnd,
    stickMove,
} from "../../packages/client/src/game/touchstick"

describe("createStickState", () => {
    it("starts inactive with a zeroed vector and nub", () => {
        const s = createStickState()
        expect(s.active).toBe(false)
        expect(s.pointerId).toBe(null)
        expect(s.x).toBe(0)
        expect(s.y).toBe(0)
        expect(s.nubX).toBe(0)
        expect(s.nubY).toBe(0)
    })
})

describe("stickBegin", () => {
    it("anchors the origin at the landing point and activates the stick", () => {
        const s = createStickState()
        stickBegin(s, 7, 200, 300)
        expect(s.active).toBe(true)
        expect(s.pointerId).toBe(7)
        expect(s.originX).toBe(200)
        expect(s.originY).toBe(300)
        // The vector and nub start zeroed - landing alone is no deflection.
        expect(s.x).toBe(0)
        expect(s.y).toBe(0)
        expect(s.nubX).toBe(0)
        expect(s.nubY).toBe(0)
    })
})

describe("stickMove", () => {
    it("zeroes the input vector inside the deadzone", () => {
        const s = createStickState()
        stickBegin(s, 1, 100, 100)
        // Move a hair: well under STICK_DEADZONE * STICK_RADIUS px from origin.
        const tiny = STICK_DEADZONE * STICK_RADIUS * 0.5
        stickMove(s, 100 + tiny, 100)
        expect(s.x).toBe(0)
        expect(s.y).toBe(0)
    })

    it("still moves the nub inside the deadzone (visual follows the finger)", () => {
        const s = createStickState()
        stickBegin(s, 1, 100, 100)
        const tiny = STICK_DEADZONE * STICK_RADIUS * 0.5
        stickMove(s, 100 + tiny, 100)
        // Input vector is deadzoned to zero, but the nub tracks the thumb.
        expect(s.x).toBe(0)
        expect(s.nubX).toBeCloseTo(tiny, 10)
        expect(s.nubY).toBeCloseTo(0, 10)
    })

    it("produces a normalized vector past the deadzone", () => {
        const s = createStickState()
        stickBegin(s, 1, 0, 0)
        // Halfway to the rim along +x → magnitude ~0.5.
        stickMove(s, STICK_RADIUS * 0.5, 0)
        expect(s.x).toBeCloseTo(0.5, 10)
        expect(s.y).toBeCloseTo(0, 10)
        expect(s.nubX).toBeCloseTo(STICK_RADIUS * 0.5, 10)
    })

    it("clamps the vector to the unit disc past the rim", () => {
        const s = createStickState()
        stickBegin(s, 1, 0, 0)
        // Push far past the rim along +x: vector clamps to magnitude 1.
        stickMove(s, STICK_RADIUS * 4, 0)
        expect(Math.hypot(s.x, s.y)).toBeCloseTo(1, 10)
        expect(s.x).toBeCloseTo(1, 10)
    })

    it("clamps the nub to the rim past the rim (radius px)", () => {
        const s = createStickState()
        stickBegin(s, 1, 0, 0)
        // Diagonal push far past the rim: nub sits ON the rim at radius distance.
        stickMove(s, STICK_RADIUS * 10, STICK_RADIUS * 10)
        expect(Math.hypot(s.nubX, s.nubY)).toBeCloseTo(STICK_RADIUS, 6)
    })

    it("clamps the vector diagonally to magnitude 1 (no axis exceeds the disc)", () => {
        const s = createStickState()
        stickBegin(s, 1, 0, 0)
        stickMove(s, STICK_RADIUS * 5, STICK_RADIUS * 5)
        expect(Math.hypot(s.x, s.y)).toBeCloseTo(1, 10)
        // Equal diagonal → each component is 1/sqrt(2).
        expect(s.x).toBeCloseTo(Math.SQRT1_2, 10)
        expect(s.y).toBeCloseTo(Math.SQRT1_2, 10)
    })

    it("measures deflection relative to the anchored origin, not the screen", () => {
        const s = createStickState()
        stickBegin(s, 1, 500, 400)
        // Move up-and-left of the origin by half the radius on each axis.
        stickMove(s, 500 - STICK_RADIUS * 0.5, 400 - STICK_RADIUS * 0.5)
        expect(s.x).toBeCloseTo(-0.5, 10)
        expect(s.y).toBeCloseTo(-0.5, 10)
    })
})

describe("stickEnd", () => {
    it("deactivates and zeroes everything so no deflection is stranded", () => {
        const s = createStickState()
        stickBegin(s, 3, 0, 0)
        stickMove(s, STICK_RADIUS, 0)
        expect(s.x).toBeCloseTo(1, 10)
        stickEnd(s)
        expect(s.active).toBe(false)
        expect(s.pointerId).toBe(null)
        expect(s.x).toBe(0)
        expect(s.y).toBe(0)
        expect(s.nubX).toBe(0)
        expect(s.nubY).toBe(0)
    })
})
