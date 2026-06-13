import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { KeyboardListener } from "@pip-pip/core/src/client/keyboard"
import { MouseListener } from "@pip-pip/core/src/client/mouse"

// These listeners run in the browser and bind handlers to a DOM element and to
// `window`. The bug being guarded against: setTarget used `handler.bind(this)`
// inline while destroy used a *fresh* `handler.bind(this)`, so the references
// never matched and removeEventListener was a silent no-op — leaking a listener
// on every setTarget/destroy cycle. The fix binds each handler once and reuses
// that identical reference for add and remove.
//
// Tests run in the `node` environment (no real DOM), so we use a tiny recorder
// that mimics just the EventTarget surface the listeners touch and asserts that
// every added handler is removed with the same reference.

type Recorded = { type: string, handler: EventListenerOrEventListenerObject }

class RecordingTarget {
    added: Recorded[] = []
    removed: Recorded[] = []

    addEventListener(type: string, handler: EventListenerOrEventListenerObject){
        this.added.push({ type, handler })
    }

    removeEventListener(type: string, handler: EventListenerOrEventListenerObject){
        this.removed.push({ type, handler })
    }
}

// Assert every add was matched by a remove with the identical handler reference,
// and that the add/remove counts are equal (no leaked or stray listeners).
function expectSymmetricTeardown(target: RecordingTarget, win: RecordingTarget){
    for(const recorder of [target, win]){
        expect(recorder.removed.length).toBe(recorder.added.length)
        for(const { type, handler } of recorder.added){
            const match = recorder.removed.find(r => r.type === type && r.handler === handler)
            expect(match, `expected a removeEventListener("${type}", <same ref>)`).toBeDefined()
        }
    }
}

let originalWindow: unknown
let fakeWindow: RecordingTarget

beforeEach(() => {
    originalWindow = (globalThis as { window?: unknown }).window
    fakeWindow = new RecordingTarget()
    ;(globalThis as { window?: unknown }).window = fakeWindow
})

afterEach(() => {
    ;(globalThis as { window?: unknown }).window = originalWindow
})

describe("KeyboardListener add/remove symmetry", () => {
    it("removes every handler it added, by identical reference", () => {
        const target = new RecordingTarget()
        const listener = new KeyboardListener()

        listener.setTarget(target as unknown as HTMLElement)
        listener.destroy()

        expectSymmetricTeardown(target, fakeWindow)
        // Sanity: it actually registered something on each surface.
        expect(target.added.length).toBeGreaterThan(0)
        expect(fakeWindow.added.length).toBeGreaterThan(0)
    })

    it("uses the same bound reference across separate setTarget calls", () => {
        const target = new RecordingTarget()
        const listener = new KeyboardListener()

        listener.setTarget(target as unknown as HTMLElement)
        const firstHandlers = target.added.map(a => a.handler)

        // setTarget calls destroy() then re-adds; the second registration must
        // reuse the same bound references, so removeEventListener keeps working.
        listener.setTarget(target as unknown as HTMLElement)
        const secondHandlers = target.added.slice(firstHandlers.length).map(a => a.handler)

        expect(secondHandlers).toEqual(firstHandlers)
    })
})

describe("MouseListener add/remove symmetry", () => {
    it("removes every handler it added, by identical reference", () => {
        const target = new RecordingTarget()
        const listener = new MouseListener()

        listener.setTarget(target as unknown as HTMLElement)
        listener.destroy()

        expectSymmetricTeardown(target, fakeWindow)
        expect(target.added.length).toBeGreaterThan(0)
        expect(fakeWindow.added.length).toBeGreaterThan(0)
    })

    it("uses the same bound reference across separate setTarget calls", () => {
        const target = new RecordingTarget()
        const listener = new MouseListener()

        listener.setTarget(target as unknown as HTMLElement)
        const firstHandlers = target.added.map(a => a.handler)

        listener.setTarget(target as unknown as HTMLElement)
        const secondHandlers = target.added.slice(firstHandlers.length).map(a => a.handler)

        expect(secondHandlers).toEqual(firstHandlers)
    })
})
