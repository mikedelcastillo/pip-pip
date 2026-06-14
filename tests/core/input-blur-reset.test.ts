import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { KeyboardListener } from "@pip-pip/core/src/client/keyboard"
import { MouseListener } from "@pip-pip/core/src/client/mouse"

// A window stub that records AND can dispatch to registered handlers, so a real
// "blur" firing can be simulated in the node environment (no real DOM). Mirrors
// the RecordingTarget in listeners.test.ts but adds dispatch().
class FakeWindow {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handlers: Record<string, ((...a: any[]) => void)[]> = {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    addEventListener(type: string, handler: (...a: any[]) => void){ (this.handlers[type] ||= []).push(handler) }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    removeEventListener(type: string, handler: (...a: any[]) => void){ this.handlers[type] = (this.handlers[type] || []).filter(h => h !== handler) }
    dispatch(type: string){ for(const h of (this.handlers[type] || []).slice()) h() }
}

// A no-op element: the listeners bind keydown/mouse handlers to it, but these
// tests only exercise the window-level focus-loss path.
const noopElement = () => ({ addEventListener(){ /* */ }, removeEventListener(){ /* */ } }) as unknown as HTMLElement

let originalWindow: unknown
let fakeWindow: FakeWindow

beforeEach(() => {
    originalWindow = (globalThis as { window?: unknown }).window
    fakeWindow = new FakeWindow()
    ;(globalThis as { window?: unknown }).window = fakeWindow
})

afterEach(() => {
    ;(globalThis as { window?: unknown }).window = originalWindow
})

// Regression: keyup/mouseup are bound to window, so a release that happens while
// the window is blurred (Alt+Tab / Cmd+Tab) is never seen and the held key/button
// stays down forever, driving movement/fire in the authoritative sim. A window
// 'blur' handler now clears the held state.
describe("KeyboardListener clears held keys on focus loss", () => {
    it("a window blur clears every held key", () => {
        const kb = new KeyboardListener()
        kb.setTarget(noopElement())
        kb.setState("KeyW", true)
        kb.setState("KeyA", true)

        fakeWindow.dispatch("blur")

        expect(kb.state["KeyW"]).toBeFalsy()
        expect(kb.state["KeyA"]).toBeFalsy()
        kb.destroy()
    })

    it("emits the declared blur event when held state is cleared", () => {
        const kb = new KeyboardListener()
        let blurred = 0
        kb.on("blur", () => { blurred += 1 })
        kb.clearHeld()
        expect(blurred).toBe(1)
    })

    it("stops clearing after destroy (the blur listener is removed)", () => {
        const kb = new KeyboardListener()
        kb.setTarget(noopElement())
        kb.destroy()
        kb.setState("KeyW", true)
        fakeWindow.dispatch("blur") // listener was removed
        expect(kb.state["KeyW"]).toBe(true)
    })
})

describe("MouseListener releases held buttons on focus loss", () => {
    it("a window blur releases every held button + drag", () => {
        const m = new MouseListener()
        m.setTarget(noopElement())
        m.state.left.down = true
        m.state.left.dragging = true
        m.state.right.down = true

        fakeWindow.dispatch("blur")

        expect(m.state.left.down).toBe(false)
        expect(m.state.left.dragging).toBe(false)
        expect(m.state.right.down).toBe(false)
        m.destroy()
    })
})
