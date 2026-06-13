import { describe, expect, it } from "vitest"
import {
    createTouchState,
    refreshTouchActive,
    stickToAim,
    stickToMovement,
} from "../../packages/client/src/game/touch"

describe("stickToMovement", () => {
    it("returns no movement inside the deadzone", () => {
        const { amount } = stickToMovement(5, 0, 10, 50)
        expect(amount).toBe(0)
    })

    it("returns no movement exactly at the deadzone edge", () => {
        const { amount } = stickToMovement(10, 0, 10, 50)
        expect(amount).toBe(0)
    })

    it("returns full deflection at and beyond the max radius", () => {
        // Right at the rim.
        expect(stickToMovement(50, 0, 10, 50).amount).toBeCloseTo(1, 10)
        // Past the rim still clamps to 1.
        expect(stickToMovement(120, 0, 10, 50).amount).toBe(1)
    })

    it("ramps linearly from the deadzone edge to the rim", () => {
        // Halfway between deadzone (10) and max (50) is distance 30 → 0.5.
        const { amount } = stickToMovement(30, 0, 10, 50)
        expect(amount).toBeCloseTo(0.5, 10)
    })

    it("reports the angle via atan2 of the deflection", () => {
        // Pointing straight up in screen space (dy negative) → -PI/2.
        expect(stickToMovement(0, -50, 10, 50).angle).toBeCloseTo(-Math.PI / 2, 10)
        // Pointing left → PI.
        expect(stickToMovement(-50, 0, 10, 50).angle).toBeCloseTo(Math.PI, 10)
        // Down-right diagonal → PI/4.
        expect(stickToMovement(50, 50, 10, 50).angle).toBeCloseTo(Math.PI / 4, 10)
    })
})

describe("stickToAim", () => {
    it("is inactive inside the deadzone so a resting stick never snaps aim", () => {
        const aim = stickToAim(6, 6, 12)
        expect(aim.active).toBe(false)
    })

    it("activates past the deadzone with the correct atan2 rotation", () => {
        const aim = stickToAim(0, 40, 12)
        expect(aim.active).toBe(true)
        // Straight down → PI/2.
        expect(aim.rotation).toBeCloseTo(Math.PI / 2, 10)
    })

    it("matches atan2 for an arbitrary deflection", () => {
        const dx = -30
        const dy = 17
        const aim = stickToAim(dx, dy, 5)
        expect(aim.active).toBe(true)
        expect(aim.rotation).toBeCloseTo(Math.atan2(dy, dx), 10)
    })
})

describe("refreshTouchActive", () => {
    it("is inactive when nothing is engaged", () => {
        const state = createTouchState()
        refreshTouchActive(state)
        expect(state.active).toBe(false)
    })

    it("is active when the move stick is engaged", () => {
        const state = createTouchState()
        state.moveActive = true
        refreshTouchActive(state)
        expect(state.active).toBe(true)
    })

    it("is active when only an action button is held", () => {
        const state = createTouchState()
        state.useTactical = true
        refreshTouchActive(state)
        expect(state.active).toBe(true)
    })
})
