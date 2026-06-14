import { describe, expect, it } from "vitest"
import { SFX_TABLE } from "@pip-pip/client/src/game/audio/sfxDefs"
import {
    ClickableLike,
    shouldPlayClickFor,
} from "@pip-pip/client/src/game/audio/uiClick"

// The uiClick cue fires on EVERY button press across the whole app, so its
// definition is held to a deliberately gentle contract: a soft waveform, a
// short duration, and a low peak gain. These assertions lock that intent in so
// a future tweak cannot accidentally turn the constant tick into something
// fatiguing.
describe("uiClick sfx def", () => {
    const def = SFX_TABLE.uiClick

    it("is defined", () => {
        expect(def).toBeDefined()
    })

    it("uses a soft waveform (sine or triangle, never square/sawtooth)", () => {
        expect(["sine", "triangle"]).toContain(def.waveform)
    })

    it("is short (<= 80 ms) so it never lingers under rapid clicking", () => {
        expect(def.duration).toBeGreaterThan(0)
        expect(def.duration).toBeLessThanOrEqual(0.08)
    })

    it("is low gain (<= 0.2) because it plays constantly", () => {
        expect(def.gain).toBeGreaterThan(0)
        expect(def.gain).toBeLessThanOrEqual(0.2)
    })

    it("adds no noise layer (a clean tick, not a burst)", () => {
        expect(def.noiseAmount).toBe(0)
    })

    it("has a valid envelope that starts at t=0 and ends at t=1", () => {
        const env = def.envelope
        expect(env.length).toBeGreaterThan(0)
        expect(env[0].t).toBe(0)
        expect(env[env.length - 1].t).toBe(1)
    })
})

// A tiny stand-in for a DOM element. The suite runs under node (no DOM), so we
// model just the slice shouldPlayClickFor reads: a self/closest lookup against a
// fixed selector and the disabled / aria-disabled flags. `closest` here returns
// `self` when the element is meant to BE a button-like control.
type StubOptions = {
    isButton?: boolean // self matches "button, [role=button]"
    isExcluded?: boolean // self (or its ancestor) is #game-container / touch overlay
    disabled?: boolean
    ariaDisabled?: boolean
}

function stub(opts: StubOptions = {}): ClickableLike {
    const node: ClickableLike = {
        tagName: opts.isButton === true ? "BUTTON" : "DIV",
        disabled: opts.disabled,
        parentElement: null,
        getAttribute(name: string): string | null {
            if (name === "aria-disabled") {
                return opts.ariaDisabled === true ? "true" : null
            }
            return null
        },
        closest(selector: string): ClickableLike | null {
            if (selector.includes("button")) {
                return opts.isButton === true ? node : null
            }
            // The excluded selector (#game-container / touch overlay).
            return opts.isExcluded === true ? node : null
        },
    }
    return node
}

describe("shouldPlayClickFor", () => {
    it("plays for a plain enabled button", () => {
        expect(shouldPlayClickFor(stub({ isButton: true }))).toBe(true)
    })

    it("does not play for a non-button target", () => {
        expect(shouldPlayClickFor(stub({ isButton: false }))).toBe(false)
    })

    it("does not play for a null target", () => {
        expect(shouldPlayClickFor(null)).toBe(false)
    })

    it("does not play for a disabled button", () => {
        expect(shouldPlayClickFor(stub({ isButton: true, disabled: true }))).toBe(false)
    })

    it("does not play for an aria-disabled button", () => {
        expect(shouldPlayClickFor(stub({ isButton: true, ariaDisabled: true }))).toBe(false)
    })

    it("does not play inside the game canvas / touch overlay", () => {
        expect(shouldPlayClickFor(stub({ isButton: true, isExcluded: true }))).toBe(false)
    })
})
