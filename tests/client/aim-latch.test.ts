import { describe, expect, it } from "vitest"
import { createAimState, resolveAimRotation } from "../../packages/client/src/game/aim"

// The aim latch is what makes releasing a touch/gamepad stick HOLD the last
// aimed direction instead of snapping back to the mouse. These exercise the pure
// resolver plus a release sequence.

describe("resolveAimRotation", () => {
    it("an active stick always wins, regardless of the mouse", () => {
        expect(resolveAimRotation(0, true, 1.0, 2.5)).toBe(2.5)
        expect(resolveAimRotation(0, false, 1.0, 2.5)).toBe(2.5)
    })

    it("adopts the mouse angle when the mouse moved and no stick is active", () => {
        expect(resolveAimRotation(0, true, 1.23, null)).toBe(1.23)
    })

    it("holds the previous aim when the mouse is idle and no stick is active", () => {
        // This is the released-stick case: nothing drives aim, so it stays put.
        expect(resolveAimRotation(2.5, false, 1.23, null)).toBe(2.5)
    })
})

describe("aim latch release sequence", () => {
    it("keeps the last stick angle after the stick is released (mouse idle)", () => {
        const aim = createAimState()
        const mouseAngle = 0.1

        // Tick 1: stick deflected to 2.0 -> aim follows and latches.
        aim.rotation = resolveAimRotation(aim.rotation, false, mouseAngle, 2.0)
        expect(aim.rotation).toBe(2.0)

        // Tick 2: stick pushed to 2.3 -> latch tracks it.
        aim.rotation = resolveAimRotation(aim.rotation, false, mouseAngle, 2.3)
        expect(aim.rotation).toBe(2.3)

        // Tick 3: stick RELEASED (null) with an idle mouse -> hold 2.3, do NOT
        // snap to the mouse angle. This is the bug being fixed.
        aim.rotation = resolveAimRotation(aim.rotation, false, mouseAngle, null)
        expect(aim.rotation).toBe(2.3)

        // Tick 4: still released, mouse still idle -> still held.
        aim.rotation = resolveAimRotation(aim.rotation, false, mouseAngle, null)
        expect(aim.rotation).toBe(2.3)
    })

    it("lets the mouse take back over once it actually moves", () => {
        const aim = createAimState()
        aim.rotation = resolveAimRotation(aim.rotation, false, 0, 2.3) // stick
        aim.rotation = resolveAimRotation(aim.rotation, false, 0, null) // released, held
        expect(aim.rotation).toBe(2.3)
        // Mouse moves: it reclaims aim.
        aim.rotation = resolveAimRotation(aim.rotation, true, 0.7, null)
        expect(aim.rotation).toBe(0.7)
    })
})
