import { describe, expect, it } from "vitest"
import {
    GamepadLike,
    axesToAim,
    axesToMovement,
    createGamepadState,
    isButtonPressed,
    pollGamepad,
    refreshGamepadActive,
} from "../../packages/client/src/game/gamepad"

// Build a synthetic standard-mapping pad. `pressed` lists the button indices to
// report as held; everything up to index 16 exists but unpressed.
const makePad = (axes: number[], pressed: number[] = []): GamepadLike => ({
    axes,
    buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: pressed.includes(i) })),
})

describe("axesToMovement", () => {
    it("returns no movement inside the deadzone", () => {
        expect(axesToMovement(0.1, 0, 0.25).amount).toBe(0)
    })

    it("returns no movement exactly at the deadzone edge", () => {
        expect(axesToMovement(0.25, 0, 0.25).amount).toBe(0)
    })

    it("ramps from the deadzone edge to full deflection", () => {
        // Distance 1 (full) past deadzone 0.25 → amount 1.
        expect(axesToMovement(1, 0, 0.25).amount).toBeCloseTo(1, 10)
        // Halfway between deadzone (0.25) and rim (1) is distance 0.625 → 0.5.
        expect(axesToMovement(0.625, 0, 0.25).amount).toBeCloseTo(0.5, 10)
    })

    it("clamps past the rim to 1", () => {
        // An over-unity diagonal (some pads report slightly >1) still clamps.
        expect(axesToMovement(1, 1, 0.25).amount).toBe(1)
    })

    it("reports the angle via atan2 of the deflection", () => {
        // Straight up (y negative) → -PI/2.
        expect(axesToMovement(0, -1, 0.25).angle).toBeCloseTo(-Math.PI / 2, 10)
        // Left → PI.
        expect(axesToMovement(-1, 0, 0.25).angle).toBeCloseTo(Math.PI, 10)
    })
})

describe("axesToAim", () => {
    it("is inactive inside the deadzone", () => {
        expect(axesToAim(0.2, 0.2, 0.35).active).toBe(false)
    })

    it("activates past the deadzone with the correct rotation", () => {
        const aim = axesToAim(0, 1, 0.35)
        expect(aim.active).toBe(true)
        // Straight down → PI/2.
        expect(aim.rotation).toBeCloseTo(Math.PI / 2, 10)
    })
})

describe("isButtonPressed", () => {
    it("is false for an unbound (-1) index", () => {
        expect(isButtonPressed(makePad([0, 0, 0, 0]), -1)).toBe(false)
    })

    it("is false for an out-of-range index", () => {
        expect(isButtonPressed(makePad([0, 0, 0, 0]), 99)).toBe(false)
    })

    it("reflects the pressed state of a bound button", () => {
        const pad = makePad([0, 0, 0, 0], [7])
        expect(isButtonPressed(pad, 7)).toBe(true)
        expect(isButtonPressed(pad, 5)).toBe(false)
    })
})

describe("refreshGamepadActive", () => {
    it("is inactive when nothing is engaged", () => {
        const state = createGamepadState()
        refreshGamepadActive(state)
        expect(state.active).toBe(false)
    })

    it("is active when only an action button is held", () => {
        const state = createGamepadState()
        state.useTactical = true
        refreshGamepadActive(state)
        expect(state.active).toBe(true)
    })
})

const BUTTONS = { fire: 7, tactical: 5, reload: 2 }

describe("pollGamepad", () => {
    it("resets to inactive when there is no pad", () => {
        const state = createGamepadState()
        state.useWeapon = true
        state.moveActive = true
        pollGamepad(state, null, BUTTONS)
        expect(state.active).toBe(false)
        expect(state.useWeapon).toBe(false)
        expect(state.moveActive).toBe(false)
    })

    it("reads left-stick movement past the deadzone", () => {
        const state = createGamepadState()
        // Left stick pushed fully right (axes[0]=1), sticks 2/3 centred.
        pollGamepad(state, makePad([1, 0, 0, 0]), BUTTONS)
        expect(state.moveActive).toBe(true)
        expect(state.movementAmount).toBeCloseTo(1, 10)
        expect(state.movementAngle).toBeCloseTo(0, 10)
        expect(state.active).toBe(true)
    })

    it("ignores a left stick resting inside the deadzone", () => {
        const state = createGamepadState()
        pollGamepad(state, makePad([0.1, 0, 0, 0]), BUTTONS)
        expect(state.moveActive).toBe(false)
        expect(state.movementAmount).toBe(0)
    })

    it("reads right-stick aim past the deadzone", () => {
        const state = createGamepadState()
        // Right stick (axes[2], axes[3]) pushed down.
        pollGamepad(state, makePad([0, 0, 0, 1]), BUTTONS)
        expect(state.aimActive).toBe(true)
        expect(state.aimRotation).toBeCloseTo(Math.PI / 2, 10)
    })

    it("maps the bound buttons to the action intents", () => {
        const state = createGamepadState()
        pollGamepad(state, makePad([0, 0, 0, 0], [7, 2]), BUTTONS)
        expect(state.useWeapon).toBe(true) // fire = 7
        expect(state.useTactical).toBe(false) // 5 not pressed
        expect(state.doReload).toBe(true) // reload = 2
        expect(state.active).toBe(true)
    })

    it("stays inactive when the pad reports no input", () => {
        const state = createGamepadState()
        pollGamepad(state, makePad([0, 0, 0, 0]), BUTTONS)
        expect(state.active).toBe(false)
    })
})
